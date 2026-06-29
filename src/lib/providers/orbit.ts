import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

// Orbit (or/): premium reseller fronting Amazon Kiro Pro (Claude family +
// DeepSeek + GLM + Minimax, including "-agentic" variants with the full Kiro
// IDE system prompt). We talk to the Anthropic-NATIVE endpoint
// (/api/provider/agy/v1/messages) because Orbit's OpenAI-compat /v1
// adapter strips any `<word>` pattern in the response (treats it as an HTML
// tag) — code with TypeScript generics or `<` comparisons comes out broken
// or cut off. The Anthropic endpoint returns clean text with `<` JSON-escaped.
//
// This file adapts our internal OpenAI-shape requests/responses to/from
// Anthropic's /messages format so the rest of the router (completions/route.ts
// stream parser, usage extraction, etc.) keeps working unchanged.
//
// Billed as a premium provider — flat 1 credit per request + per-model
// premium_request_cost against the daily premium pool. Same shape as
// trolllm/dlab/hapuppy/riftai.

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const ANTHROPIC_VERSION = "2023-06-01";
// Stall guard for the translated SSE stream: if the upstream sends
// message_start (or pings) then stalls without ever producing content / a
// terminal message_stop, the transform emits nothing and the client hangs.
// Cap the dead air; tune via ORBIT_STREAM_STALL_MS.
const STREAM_STALL_MS =
  Number(process.env.ORBIT_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;
// CF in front of Orbit blocks python-urllib UAs with error 1010. Use an
// Anthropic-SDK-shaped UA to look like a normal client.
const USER_AGENT = "anthropic-sdk-typescript/0.30.0";
// Anthropic requires max_tokens. Pick a generous default for the Kiro
// system-prompt overhead + room for the answer.
const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
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
      // the top-level Anthropic `system` prompt. System messages injected
      // mid-conversation — e.g. SillyTavern depth injections / jailbreaks /
      // formatting presets — must stay at their position: hoisting them to the
      // top makes some Claude variants (notably opus-4-8) ignore them entirely.
      // Convert those to an inline user turn so the model still honours them.
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
      // Merge consecutive same-role messages into one to satisfy
      // Anthropic's strict user/assistant alternation requirement.
      const last = out[out.length - 1];
      if (last && last.role === m.role) {
        last.content = stringifyContent(last.content) + "\n\n" + text;
      } else {
        out.push({ role: m.role, content: text });
      }
    }
    // tool / function roles intentionally dropped — v1 of the adapter
    // does not translate tool-call traffic. Aether's other premium
    // providers also pass tools straight through the OpenAI shape;
    // adding Anthropic tool-call translation can come later.
  }

  // Anthropic requires the first message to be from `user`. Prepend a
  // placeholder so an assistant-only or empty prefix doesn't 400 us.
  if (out.length === 0 || out[0].role !== "user") {
    out.unshift({ role: "user", content: "" });
  }

  // Pull the max-tokens hint from either OpenAI field name.
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
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");
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
    id: anth.id || `orbit-${Date.now()}`,
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

// Translate Anthropic SSE -> OpenAI SSE on the fly.
//
// Anthropic emits a sequence of typed events (message_start,
// content_block_start, content_block_delta, content_block_stop,
// message_delta, message_stop). OpenAI's wire format is one chunk per
// delta, each shaped like a chat.completion.chunk with optional usage
// and a [DONE] sentinel.
function makeAnthropicToOpenAIStreamTransform(
  model: string
): TransformStream<Uint8Array, Uint8Array> {
  const id = `orbit-${Date.now()}`;
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
        // OpenAI clients usually expect a leading role chunk.
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
      // Surface extended-thinking blocks as `reasoning_content` (the DeepSeek/
      // OpenAI-compat convention) instead of dropping them, so clients that
      // want to show the model's reasoning can. `signature_delta` is ignored.
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
      // Final finish_reason + usage roll-up chunk, then [DONE].
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
    // Anthropic SSE separates events by a blank line ("\n\n"). Each event
    // can carry an `event:` line and one or more `data:` lines.
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
      // Anthropic should always send message_stop, but if the stream
      // ended early make sure the consumer still gets a [DONE].
      emitDone(controller);
    },
  });
}

// ORBIT_API_KEY may hold a single key or a comma-separated pool. For the
// enterprise volume (600M tokens/week) a single Kiro account can't keep up,
// so we spread load across keys and, on a per-key rate-limit (429) or
// transient 5xx, fail over to a DIFFERENT key on retry. Trailing
// whitespace/newlines are trimmed — PS-set secrets sometimes carry \r\n (→ 401).
function getOrbitKeys(): string[] {
  return (process.env.ORBIT_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Fisher-Yates shuffle so each request starts on a random key (load spread)
// and successive retries walk distinct keys.
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const orbitProvider: Provider = {
  name: "orbit",
  baseUrl:
    process.env.ORBIT_BASE_URL ||
    "https://api.orbit-provider.com/api/provider/agy",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getOrbitKeys();
    if (keys.length === 0) {
      throw new Error("ORBIT_API_KEY not configured");
    }
    // Distinct key per attempt (wraps if pool smaller than attempt count).
    const keyOrder = shuffled(keys);

    const wantStream = request.stream === true;
    const anthBody = openAIToAnthropic(request);

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }

      const apiKey = keyOrder[attempt % keyOrder.length];
      const keyTag = apiKey.slice(0, 10);

      const upstream = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          Accept: wantStream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(anthBody),
        signal,
      });

      // Surface upstream errors verbatim — route.ts maps them to user
      // messages and refunds the reservation. Don't try to translate
      // Anthropic error JSON to OpenAI shape; the route only inspects
      // status + raw body text on the error path.
      if (!upstream.ok) {
        // Per-key rate limit (429), per-key insufficient balance (402 — a
        // depleted Kiro key in the pool), or transient 5xx → fail over to the
        // next key on retry. 503 (global upstream down) and other 4xx return
        // as-is.
        if (upstream.status === 429 || upstream.status === 402 || (upstream.status >= 500 && upstream.status !== 503)) {
          console.warn(
            `[orbit] key ${keyTag}… attempt ${attempt + 1}/${MAX_RETRIES + 1} → ${upstream.status}; failing over to next key`
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

      // Non-stream: buffer, translate to OpenAI shape, return JSON.
      const anthJson = (await upstream.json()) as AnthropicNonStreamResponse;
      const openAi = anthropicToOpenAINonStream(anthJson, anthBody.model);
      // Orbit occasionally returns 200 OK with empty content. Treat an empty
      // body like a transient failure and retry on the next key before giving
      // up (kept as the fallback if every attempt comes back empty).
      const emptyContent = !openAi.choices[0]?.message?.content?.trim();
      const jsonResponse = new Response(JSON.stringify(openAi), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      if (emptyContent && attempt < MAX_RETRIES) {
        console.warn(
          `[orbit] key ${keyTag}… attempt ${attempt + 1}/${MAX_RETRIES + 1} → empty content; retrying on next key`
        );
        lastResponse = jsonResponse;
        continue;
      }
      return jsonResponse;
    }

    return lastResponse!;
  },
};
