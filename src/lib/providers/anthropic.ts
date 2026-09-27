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
// system-hoist workaround.
//
// Tool-calling (2026-09-27): OpenAI-shape `tools`/`tool_choice` and
// `tool_calls`/tool-result messages ARE translated both ways — see
// openAIToolsToAnthropic / anthropic tool_use <-> OpenAI tool_calls below.
// This mirrors (in the opposite direction) src/lib/anthropic/translate.ts,
// which does the same job for the client-facing /v1/messages endpoint.
// Still NOT translated: image content blocks (vision) — text and tool
// traffic only. Suitable for Claude Code / tool-using clients now; multimodal
// clients still are not.
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
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
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

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: unknown;
}

interface AnthropicToolChoice {
  type: "auto" | "any" | "tool" | "none";
  name?: string;
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
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
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

// Minimal shape of what we read off an incoming OpenAI-style message —
// ProviderRequest's ChatMessage type doesn't carry tool fields, so read them
// defensively off the raw object.
interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface RawOpenAIMessage {
  role: string;
  content?: unknown;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
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

// OpenAI image_url (data URL or http URL) -> Anthropic image block.
function imageUrlToBlock(url: unknown): AnthropicContentBlock | null {
  if (typeof url !== "string") return null;
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (m) return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  if (/^https?:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
  return null;
}

// OpenAI message content (string or text/image_url parts) -> Anthropic blocks.
// Empty text is dropped: Anthropic 400s on empty text blocks.
function contentToBlocks(content: unknown): AnthropicContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part) blocks.push({ type: "text", text: part });
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: unknown; image_url?: unknown };
    if (p.type === "text" && typeof p.text === "string") {
      if (p.text) blocks.push({ type: "text", text: p.text });
    } else if (p.type === "image_url") {
      const url = typeof p.image_url === "string" ? p.image_url : (p.image_url as { url?: unknown } | undefined)?.url;
      const img = imageUrlToBlock(url);
      if (img) blocks.push(img);
    }
  }
  return blocks;
}

// tool_result content: plain string when text-only, blocks when images.
function toolResultContent(content: unknown): string | AnthropicContentBlock[] {
  if (typeof content === "string") return content;
  const blocks = contentToBlocks(content);
  if (blocks.every((b) => b.type === "text")) return blocks.map((b) => b.text).join("");
  return blocks;
}

function safeParseJson(text: string | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// OpenAI `tools` (function-calling) -> Anthropic `tools`.
function translateTools(req: ProviderRequest): AnthropicTool[] | undefined {
  const toolsIn = (req as Record<string, unknown>).tools;
  if (!Array.isArray(toolsIn) || toolsIn.length === 0) return undefined;
  const tools = toolsIn
    .filter(
      (t): t is { type: string; function: { name: string; description?: string; parameters?: unknown } } =>
        !!t && typeof t === "object" && (t as Record<string, unknown>).type === "function" &&
        typeof (t as { function?: { name?: unknown } }).function?.name === "string"
    )
    .map((t) => ({
      name: t.function.name,
      ...(t.function.description ? { description: String(t.function.description) } : {}),
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  return tools.length > 0 ? tools : undefined;
}

// OpenAI `tool_choice` -> Anthropic `tool_choice`.
function translateToolChoice(req: ProviderRequest): AnthropicToolChoice | undefined {
  const tc = (req as Record<string, unknown>).tool_choice;
  if (typeof tc === "string") {
    if (tc === "auto") return { type: "auto" };
    if (tc === "required") return { type: "any" };
    if (tc === "none") return { type: "none" };
    return undefined;
  }
  if (tc && typeof tc === "object") {
    const t = tc as { type?: string; function?: { name?: string } };
    if (t.type === "function" && typeof t.function?.name === "string") {
      return { type: "tool", name: t.function.name };
    }
  }
  return undefined;
}

// Exported for tests/anthropic-direct-tools.test.ts — the request/response
// tool-call translation is the trickiest part of this adapter and worth
// covering directly, same as src/lib/anthropic/translate.ts is tested in the
// opposite direction.
export function openAIToAnthropic(req: ProviderRequest): AnthropicRequestBody {
  const systemParts: string[] = [];
  // Every message becomes a block array, and consecutive same-role messages
  // are merged. That one rule covers: several OpenAI `tool` messages
  // answering one parallel tool_use turn (Anthropic wants a single user
  // turn), user text arriving alongside tool results (Claude Code's
  // <system-reminder>s), and mid-conversation system text inlined into a
  // user turn. Empty messages are dropped — Anthropic 400s on empty content.
  const out: AnthropicMessage[] = [];
  let seenConversation = false;

  function append(role: "user" | "assistant", blocks: AnthropicContentBlock[]) {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      (last.content as AnthropicContentBlock[]).push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  }

  for (const raw of req.messages || []) {
    const m = raw as unknown as RawOpenAIMessage;

    if (m.role === "system") {
      const text = stringifyContent(m.content);
      if (!text) continue;
      // Only LEADING system messages (before any user/assistant turn) become
      // the top-level Anthropic `system` prompt. Mid-conversation system
      // messages (SillyTavern depth injections, jailbreaks, formatting
      // presets) must stay at their position — hoisting them to the top makes
      // some Claude variants ignore them (same bug fixed for orbit.ts, see
      // project_aether_orbit_st_systemhoist). Inline them as user text.
      if (!seenConversation) systemParts.push(text);
      else append("user", [{ type: "text", text }]);
      continue;
    }
    seenConversation = true;

    if (m.role === "tool") {
      const content = toolResultContent(m.content);
      append("user", [
        {
          type: "tool_result",
          tool_use_id: String(m.tool_call_id ?? ""),
          ...(content.length > 0 ? { content } : {}),
        },
      ]);
    } else if (m.role === "assistant") {
      const blocks = contentToBlocks(m.content);
      (m.tool_calls ?? []).forEach((call, i) => {
        blocks.push({
          type: "tool_use",
          id: String(call.id ?? `toolu_${i}`),
          name: String(call.function?.name ?? ""),
          input: safeParseJson(call.function?.arguments),
        });
      });
      append("assistant", blocks);
    } else if (m.role === "user") {
      append("user", contentToBlocks(m.content));
    }
  }

  // Anthropic rejects a user turn whose tool_result blocks don't come first.
  for (const turn of out) {
    if (turn.role !== "user") continue;
    const blocks = turn.content as AnthropicContentBlock[];
    const results = blocks.filter((b) => b.type === "tool_result");
    if (results.length > 0 && blocks[0].type !== "tool_result") {
      turn.content = [...results, ...blocks.filter((b) => b.type !== "tool_result")];
    }
  }

  // Anthropic requires the first message to be from `user`.
  if (out.length === 0 || out[0].role !== "user") {
    out.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
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
  const tools = translateTools(req);
  if (tools) body.tools = tools;
  const toolChoice = translateToolChoice(req);
  if (toolChoice) body.tool_choice = toolChoice;

  return body;
}

export function anthropicToOpenAINonStream(
  anth: AnthropicNonStreamResponse,
  model: string
): {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    };
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
  const textParts: string[] = [];
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
  for (const b of anth.content ?? []) {
    if (b.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    } else if (b.type === "tool_use") {
      toolCalls.push({
        id: String(b.id ?? `toolu_${toolCalls.length}`),
        type: "function",
        function: {
          name: String(b.name ?? ""),
          arguments: JSON.stringify(b.input ?? {}),
        },
      });
    }
  }

  // Anthropic's input_tokens is only the UNCACHED remainder; the router
  // (extractCacheTokens, calculateCredits, usage_logs) expects OpenAI's
  // prompt_tokens = full prompt including cache. Reporting the raw
  // input_tokens made the router clamp cache_read to that tiny remainder
  // (logs showed cache_read = 4 on 78k-token requests that were ~100% hits).
  const output = Number(anth.usage?.output_tokens) || 0;
  const cacheRead = Number(anth.usage?.cache_read_input_tokens) || 0;
  const cacheWrite = Number(anth.usage?.cache_creation_input_tokens) || 0;
  const input = (Number(anth.usage?.input_tokens) || 0) + cacheRead + cacheWrite;

  const message: {
    role: "assistant";
    content: string | null;
    tool_calls?: typeof toolCalls;
  } = { role: "assistant", content: textParts.length > 0 ? textParts.join("") : null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id: anth.id || `ad-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: anth.model || model,
    choices: [
      {
        index: 0,
        message,
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
// orbit.ts's transform, plus tool_use handling (content_block_start with a
// tool_use block -> the leading OpenAI tool_calls delta carrying id+name;
// input_json_delta fragments -> the following deltas carrying only
// function.arguments, matching OpenAI's own incremental tool-call streaming
// shape — mirrors makeOpenAIToAnthropicStreamTransform in
// src/lib/anthropic/translate.ts, in the opposite direction).
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
  // Anthropic content-block index -> the OpenAI tool_calls array index we
  // assigned it (OpenAI numbers tool calls independently of other blocks).
  const toolBlockIndexMap = new Map<number, number>();
  let nextOpenAiToolIndex = 0;

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

    if (type === "content_block_start") {
      const index = Number(parsed.index);
      const block = parsed.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (block?.type === "tool_use" && Number.isFinite(index)) {
        const oaIndex = nextOpenAiToolIndex++;
        toolBlockIndexMap.set(index, oaIndex);
        emit(controller, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: oaIndex,
                    id: String(block.id ?? `toolu_${oaIndex}`),
                    type: "function",
                    function: { name: String(block.name ?? ""), arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
      }
      return;
    }

    if (type === "content_block_delta") {
      const index = Number(parsed.index);
      const delta = parsed.delta as
        | { type?: string; text?: string; thinking?: string; partial_json?: string }
        | undefined;
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
      if (
        delta?.type === "input_json_delta" &&
        typeof delta.partial_json === "string" &&
        toolBlockIndexMap.has(index)
      ) {
        emit(controller, {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: toolBlockIndexMap.get(index)!, function: { arguments: delta.partial_json } },
                ],
              },
              finish_reason: null,
            },
          ],
        });
      }
      return;
    }

    if (type === "message_delta") {
      const delta = parsed.delta as { stop_reason?: string | null } | undefined;
      const usage = parsed.usage as
        | { output_tokens?: number; input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
        | undefined;
      if (usage && typeof usage.output_tokens === "number") {
        completionTokens = usage.output_tokens;
      }
      // message_delta can carry the final (cumulative) input/cache counts.
      if (usage && typeof usage.input_tokens === "number") promptTokens = usage.input_tokens;
      if (usage && typeof usage.cache_read_input_tokens === "number") cacheRead = usage.cache_read_input_tokens;
      if (usage && typeof usage.cache_creation_input_tokens === "number") cacheWrite = usage.cache_creation_input_tokens;
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
        // OpenAI semantics: prompt_tokens includes cache (see the non-stream
        // translation for why).
        usage: {
          prompt_tokens: promptTokens + cacheRead + cacheWrite,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + cacheRead + cacheWrite + completionTokens,
          ...(cacheRead > 0 && { cache_read_input_tokens: cacheRead }),
          ...(cacheWrite > 0 && { cache_creation_input_tokens: cacheWrite }),
        },
      });
      emitDone(controller);
      return;
    }

    // content_block_stop / ping — nothing to forward.
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
