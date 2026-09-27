import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

// Anthropic direct (ad/): the REAL official api.anthropic.com, called with our
// own personal API key. NOT a reseller — this is the actual first-party API.
//
// Access is intentionally NOT plan-based. "anthropic" is left OUT of
// ALLOWED_CLAUDE_PROVIDERS/CLAUDE_PAID_ONLY_BYPASS/CLAUDE_ACTIVATION_BYPASS in
// claude-block.ts on purpose — the normal paid+claude_activated rule must never
// grant access here. The only door in is isAnthropicDirectAllowed() in
// claude-block.ts, checked in chat/completions/route.ts: a custom key (minted
// by hand, one per approved person) whose allowed_providers explicitly lists
// "anthropic". See project memory project_aether (2026-09-26) for the two
// keys created (personal + a friend).
//
// Like orbit.ts, this adapts our internal OpenAI-shape requests/responses
// to/from Anthropic's native /v1/messages format. Unlike orbit, there is no
// Kiro-style system-prompt injection or CF WAF to dodge — this is a straight
// translation layer, so it stays deliberately simple: no key pool, no
// system-hoist workaround. Same v1 limitation as orbit: tool-call traffic and
// image content are not translated (text-only), so this is not yet suitable
// for Claude Code / tool-using clients — text chat and roleplay only.
//
// Billing: premium pool, same tiering convention as kiro.ts (opus family = 6
// premium_request/call, sonnet = 3, haiku = 1; set per model in the DB). In
// practice this never gets charged — the only keys that can reach this
// provider are unlimited custom keys (custom_credits = null) — but the tier
// stays in the DB as a sane default in case a limited-credit custom key is
// ever pointed here.

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const ANTHROPIC_VERSION = "2023-06-01";
const STREAM_STALL_MS =
  Number(process.env.ANTHROPIC_DIRECT_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;
// Real Anthropic models here support up to 128k output tokens; give real
// headroom for long replies when the client didn't ask for a specific cap.
const DEFAULT_MAX_TOKENS = 8192;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
}

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: AnthropicSystemBlock[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  // Top-level automatic caching: places (and slides forward, as the
  // conversation grows) a breakpoint on the last cacheable message block.
  // Composes with the explicit breakpoint on the system block below — see
  // "the robust combination for agent loops" in Anthropic's caching docs.
  cache_control?: { type: "ephemeral" };
}

interface AnthropicNonStreamResponse {
  id?: string;
  model?: string;
  role?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function mapStopReason(stop: string | null | undefined): string {
  switch (stop) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function openAIToAnthropic(req: ProviderRequest): AnthropicRequestBody {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of req.messages || []) {
    const text = stringifyContent(m.content);
    if (m.role === "system") {
      if (!text) continue;
      // Only LEADING system messages (before any user/assistant turn) become
      // the top-level Anthropic `system` prompt. Mid-conversation system
      // messages (SillyTavern depth injections, jailbreaks, formatting
      // presets) must stay at their position — hoisting them to the top makes
      // some Claude variants ignore them (same bug fixed for orbit.ts, see
      // project_aether_orbit_st_systemhoist). Convert those to an inline user
      // turn instead.
      if (out.length === 0) {
        systemParts.push(text);
      } else {
        const last = out[out.length - 1];
        if (last && last.role === "user") {
          last.content = stringifyContent(last.content) + "\n\n" + text;
        } else {
          out.push({ role: "user", content: text });
        }
      }
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      // Merge consecutive same-role messages into one to satisfy Anthropic's
      // strict user/assistant alternation requirement.
      const last = out[out.length - 1];
      if (last && last.role === m.role) {
        last.content = stringifyContent(last.content) + "\n\n" + text;
      } else {
        out.push({ role: m.role, content: text });
      }
    }
    // tool / function roles intentionally dropped — see header comment.
  }

  // Anthropic requires the first message to be from `user`.
  if (out.length === 0 || out[0].role !== "user") {
    out.unshift({ role: "user", content: "" });
  }

  const requested =
    (typeof req.max_tokens === "number" && req.max_tokens > 0
      ? req.max_tokens
      : undefined) ??
    (typeof (req as Record<string, unknown>).max_completion_tokens === "number"
      ? ((req as Record<string, unknown>).max_completion_tokens as number)
      : undefined);

  const body: AnthropicRequestBody = {
    model: req.model,
    max_tokens: requested && requested > 0 ? requested : DEFAULT_MAX_TOKENS,
    messages: out,
    stream: req.stream === true,
    // Automatic caching for the growing conversation tail (5-minute TTL).
    cache_control: { type: "ephemeral" },
  };
  if (systemParts.length > 0) {
    // Explicit breakpoint on the (usually large, stable) system prompt —
    // character card / preset / persona — with the extended 1h TTL so it
    // survives gaps between messages, not just the default 5 minutes.
    body.system = [
      {
        type: "text",
        text: systemParts.join("\n\n"),
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ];
  }
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  const topP = (req as Record<string, unknown>).top_p;
  if (typeof topP === "number") body.top_p = topP;
  const topK = (req as Record<string, unknown>).top_k;
  if (typeof topK === "number") body.top_k = topK;
  const stop = (req as Record<string, unknown>).stop;
  if (typeof stop === "string") body.stop_sequences = [stop];
  else if (Array.isArray(stop)) {
    body.stop_sequences = stop.filter((s): s is string => typeof s === "string");
  }

  return body;
}

function anthropicToOpenAINonStream(
  anth: AnthropicNonStreamResponse,
  model: string
): {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
} {
  const text = (anth.content ?? [])
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("");

  const input = Number(anth.usage?.input_tokens) || 0;
  const output = Number(anth.usage?.output_tokens) || 0;
  const cacheRead = Number(anth.usage?.cache_read_input_tokens) || 0;
  const cacheWrite = Number(anth.usage?.cache_creation_input_tokens) || 0;

  return {
    id: anth.id || `ad-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anth.model || model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: mapStopReason(anth.stop_reason ?? null),
      },
    ],
    usage: {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: input + output,
      ...(cacheRead > 0 && { cache_read_input_tokens: cacheRead }),
      ...(cacheWrite > 0 && { cache_creation_input_tokens: cacheWrite }),
    },
  };
}

// Translate Anthropic SSE -> OpenAI SSE on the fly. Same event shapes as
// orbit.ts's transform — see that file for the per-event-type breakdown.
function makeAnthropicToOpenAIStreamTransform(
  model: string
): TransformStream<Uint8Array, Uint8Array> {
  const id = `ad-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let finalFinish: string | null = null;
  let firstChunkSent = false;
  let doneSent = false;

  function emit(controller: TransformStreamDefaultController<Uint8Array>, payload: unknown) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  }

  function emitDone(controller: TransformStreamDefaultController<Uint8Array>) {
    if (doneSent) return;
    doneSent = true;
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  }

  function handleEvent(
    ev: { event?: string; data?: string },
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    if (!ev.data) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = (parsed.type as string) || ev.event || "";

    if (type === "message_start") {
      const message = parsed.message as
        | { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
        | undefined;
      if (message?.usage) {
        promptTokens = Number(message.usage.input_tokens) || promptTokens;
        cacheRead = Number(message.usage.cache_read_input_tokens) || cacheRead;
        cacheWrite = Number(message.usage.cache_creation_input_tokens) || cacheWrite;
      }
      if (!firstChunkSent) {
        emit(controller, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });
        firstChunkSent = true;
      }
      return;
    }

    if (type === "content_block_delta") {
      const delta = parsed.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        emit(controller, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
        });
      }
      // Surface extended-thinking blocks as `reasoning_content` (DeepSeek/
      // OpenAI-compat convention) instead of dropping them.
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
        emit(controller, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { reasoning_content: delta.thinking }, finish_reason: null }],
        });
      }
      return;
    }

    if (type === "message_delta") {
      const delta = parsed.delta as { stop_reason?: string | null } | undefined;
      const usage = parsed.usage as { output_tokens?: number } | undefined;
      if (usage && typeof usage.output_tokens === "number") {
        completionTokens = usage.output_tokens;
      }
      if (delta?.stop_reason) {
        finalFinish = mapStopReason(delta.stop_reason);
      }
      return;
    }

    if (type === "message_stop") {
      emit(controller, {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finalFinish ?? "stop" }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          ...(cacheRead > 0 && { cache_read_input_tokens: cacheRead }),
          ...(cacheWrite > 0 && { cache_creation_input_tokens: cacheWrite }),
        },
      });
      emitDone(controller);
      return;
    }

    // content_block_start / content_block_stop / ping — nothing to forward.
  }

  function flushEvents(
    text: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    buffer += text;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const ev: { event?: string; data?: string } = {};
      const dataParts: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) ev.event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataParts.push(line.slice(5).trim());
      }
      if (dataParts.length > 0) ev.data = dataParts.join("");
      handleEvent(ev, controller);
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      flushEvents(decoder.decode(chunk, { stream: true }), controller);
    },
    flush(controller) {
      flushEvents(decoder.decode(), controller);
      emitDone(controller);
    },
  });
}

function getAnthropicDirectKey(): string | undefined {
  return (process.env.ANTHROPIC_DIRECT_API_KEY || "").trim() || undefined;
}

export const anthropicProvider: Provider = {
  name: "anthropic",
  baseUrl: process.env.ANTHROPIC_DIRECT_BASE_URL || "https://api.anthropic.com",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = getAnthropicDirectKey();
    if (!apiKey) {
      throw new Error("ANTHROPIC_DIRECT_API_KEY not configured");
    }

    const wantStream = request.stream === true;
    const anthBody = openAIToAnthropic(request);

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }

      const upstream = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
          Accept: wantStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(anthBody),
        signal,
      });

      if (!upstream.ok) {
        // Rate limit (429) or transient 5xx on the official API → back off and
        // retry the same key (no pool to fail over to). Other 4xx (400/401/
        // 403/404) are permanent for this request — return immediately so
        // route.ts can refund and surface the error.
        if (upstream.status === 429 || upstream.status >= 500) {
          console.warn(
            `[anthropic] attempt ${attempt + 1}/${MAX_RETRIES + 1} → ${upstream.status}; retrying`
          );
          lastResponse = upstream;
          continue;
        }
        return upstream;
      }

      if (wantStream) {
        if (!upstream.body) {
          return new Response(
            JSON.stringify({ error: { message: "Empty stream body from upstream", type: "server_error" } }),
            { status: 502, headers: { "content-type": "application/json" } }
          );
        }
        const transformed = upstream.body.pipeThrough(
          makeAnthropicToOpenAIStreamTransform(anthBody.model)
        );
        return new Response(guardSseStall(transformed, STREAM_STALL_MS), {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      const anthJson = (await upstream.json()) as AnthropicNonStreamResponse;
      const openAi = anthropicToOpenAINonStream(anthJson, anthBody.model);
      return new Response(JSON.stringify(openAi), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return lastResponse!;
  },
};
