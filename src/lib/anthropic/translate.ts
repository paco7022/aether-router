// Anthropic Messages API <-> internal OpenAI-shape translation.
//
// Aether Router's core pipeline (auth -> moderation -> routing -> billing ->
// provider forward) speaks the OpenAI Chat Completions shape end to end. To
// expose a *client-facing* Anthropic `/v1/messages` endpoint (so Claude Code,
// the Anthropic SDK, and SillyTavern's Claude API mode can point straight at
// api.aether-ai.dev) we only need to translate at the edges:
//
//   client Anthropic request  --anthropicToOpenAIRequest-->  OpenAI body
//        (reuse existing /chat/completions POST unchanged)
//   OpenAI response  --openAIToAnthropicResponse / stream transform-->  client
//
// Everything in between — including `tools`/`tool_choice` and rich message
// content — flows through untouched because the core route spreads the caller
// body verbatim (`{ ...body, model, stream }`) into the provider forward.
//
// These functions are pure so they can be unit-tested in isolation
// (tests/anthropic-translate.test.ts). Mirrors, in the opposite direction, the
// provider-facing adapter in src/lib/providers/orbit.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ----------------------------- shared types --------------------------------

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAIBody {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters?: unknown };
  }>;
  tool_choice?: unknown;
  [key: string]: unknown;
}

// --------------------------- helper utilities ------------------------------

/** Flatten an Anthropic `system` field (string | content blocks) to text. */
function systemToText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((b) =>
        b && typeof b === "object" && typeof (b as any).text === "string"
          ? (b as any).text
          : ""
      )
      .join("");
  }
  return "";
}

/** Anthropic image source block -> OpenAI image_url part. */
function imageBlockToOpenAI(block: any): any | null {
  const source = block?.source;
  if (!source || typeof source !== "object") return null;
  if (source.type === "base64" && source.media_type && source.data) {
    return {
      type: "image_url",
      image_url: { url: `data:${source.media_type};base64,${source.data}` },
    };
  }
  if (source.type === "url" && typeof source.url === "string") {
    return { type: "image_url", image_url: { url: source.url } };
  }
  return null;
}

/** Stringify a tool_result block's content for the OpenAI `tool` message. */
function toolResultContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as any;
          if (typeof p.text === "string") return p.text;
          // image / other tool_result parts are not representable in an
          // OpenAI tool message; JSON-encode so no information is silently lost.
          if (p.type && p.type !== "text") return JSON.stringify(p);
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}

// ------------------------- request translation -----------------------------

/**
 * Translate an Anthropic Messages request body into the internal OpenAI Chat
 * Completions shape that /api/v1/chat/completions expects.
 */
export function anthropicToOpenAIRequest(body: any): OpenAIBody {
  const out: OpenAIMessage[] = [];

  // `system` becomes a leading system message.
  const systemText = systemToText(body?.system);
  if (systemText) out.push({ role: "system", content: systemText });

  for (const msg of Array.isArray(body?.messages) ? body.messages : []) {
    const role = msg?.role;
    const content = msg?.content;

    // Simple string content — pass straight through.
    if (typeof content === "string") {
      out.push({ role: role === "assistant" ? "assistant" : "user", content });
      continue;
    }
    if (!Array.isArray(content)) continue;

    if (role === "assistant") {
      // Assistant turn: split text/thinking blocks (-> content) from tool_use
      // blocks (-> tool_calls) into a single OpenAI assistant message.
      const textParts: string[] = [];
      const toolCalls: NonNullable<OpenAIMessage["tool_calls"]> = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as any;
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
        // `thinking` blocks are intentionally dropped from the request replay;
        // they carry provider-signed data that isn't portable across providers.
      }
      const assistantMsg: OpenAIMessage = {
        role: "assistant",
        content: textParts.join(""),
      };
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      out.push(assistantMsg);
      continue;
    }

    // User turn: text/image blocks -> a user message (string when only text,
    // multimodal array when images are present); tool_result blocks -> one
    // OpenAI `tool` message each (they must be top-level, not nested).
    const userParts: any[] = [];
    const toolMessages: OpenAIMessage[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as any;
      if (b.type === "text" && typeof b.text === "string") {
        userParts.push({ type: "text", text: b.text });
      } else if (b.type === "image") {
        const img = imageBlockToOpenAI(b);
        if (img) userParts.push(img);
      } else if (b.type === "tool_result") {
        toolMessages.push({
          role: "tool",
          tool_call_id: String(b.tool_use_id ?? ""),
          content: toolResultContentToText(b.content),
        });
      }
    }
    if (userParts.length > 0) {
      const onlyText =
        userParts.length > 0 && userParts.every((p) => p.type === "text");
      out.push({
        role: "user",
        content: onlyText
          ? userParts.map((p) => p.text).join("")
          : userParts,
      });
    }
    // Tool results follow the (optional) user text in submission order.
    for (const tm of toolMessages) out.push(tm);
  }

  const openai: OpenAIBody = {
    model: String(body?.model ?? ""),
    messages: out,
  };

  if (typeof body?.max_tokens === "number") openai.max_tokens = body.max_tokens;
  openai.stream = body?.stream === true;
  if (typeof body?.temperature === "number") openai.temperature = body.temperature;
  if (typeof body?.top_p === "number") openai.top_p = body.top_p;
  if (typeof body?.top_k === "number") openai.top_k = body.top_k;
  if (Array.isArray(body?.stop_sequences) && body.stop_sequences.length > 0) {
    openai.stop = body.stop_sequences.filter(
      (s: unknown): s is string => typeof s === "string"
    );
  }

  // tools: Anthropic {name, description, input_schema} -> OpenAI function tool.
  if (Array.isArray(body?.tools) && body.tools.length > 0) {
    const tools = body.tools
      .filter((t: any) => t && typeof t.name === "string")
      .map((t: any) => ({
        type: "function" as const,
        function: {
          name: t.name,
          ...(t.description ? { description: String(t.description) } : {}),
          parameters: t.input_schema ?? { type: "object", properties: {} },
        },
      }));
    if (tools.length > 0) openai.tools = tools;
  }

  // tool_choice: Anthropic {type: auto|any|tool, name?} -> OpenAI equivalent.
  const tc = body?.tool_choice;
  if (tc && typeof tc === "object") {
    if (tc.type === "auto") openai.tool_choice = "auto";
    else if (tc.type === "any") openai.tool_choice = "required";
    else if (tc.type === "tool" && tc.name) {
      openai.tool_choice = { type: "function", function: { name: tc.name } };
    }
  }

  return openai;
}

// ---------------------- non-stream response translation --------------------

function mapFinishToStopReason(finish: string | null | undefined): string {
  switch (finish) {
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "content_filter":
      return "end_turn";
    case "stop":
    default:
      return "end_turn";
  }
}

/** Generate an Anthropic-style message id. */
export function genMessageId(): string {
  return `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Translate an OpenAI Chat Completion (non-stream) into an Anthropic Messages
 * response object.
 */
export function openAIToAnthropicResponse(openai: any, fallbackModel: string): any {
  const choice = openai?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const contentBlocks: any[] = [];

  // Reasoning first (extended-thinking convention some providers surface).
  if (typeof message.reasoning_content === "string" && message.reasoning_content) {
    contentBlocks.push({ type: "thinking", thinking: message.reasoning_content });
  }
  if (typeof message.content === "string" && message.content) {
    contentBlocks.push({ type: "text", text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      let input: unknown = {};
      try {
        input = call?.function?.arguments
          ? JSON.parse(call.function.arguments)
          : {};
      } catch {
        input = {};
      }
      contentBlocks.push({
        type: "tool_use",
        id: String(call?.id ?? genMessageId()),
        name: String(call?.function?.name ?? ""),
        input,
      });
    }
  }
  // Anthropic responses always carry at least one content block.
  if (contentBlocks.length === 0) contentBlocks.push({ type: "text", text: "" });

  const usage = openai?.usage ?? {};
  const inputTokens = Number(usage.prompt_tokens) || 0;
  const outputTokens = Number(usage.completion_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;

  return {
    id: String(openai?.id ?? genMessageId()),
    type: "message",
    role: "assistant",
    model: String(openai?.model ?? fallbackModel),
    content: contentBlocks,
    stop_reason: mapFinishToStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ...(cacheRead > 0 && { cache_read_input_tokens: cacheRead }),
      ...(cacheWrite > 0 && { cache_creation_input_tokens: cacheWrite }),
    },
  };
}

/** Translate an OpenAI-shape error body into the Anthropic error envelope. */
export function openAIErrorToAnthropic(openaiErr: any): any {
  const err = openaiErr?.error ?? openaiErr ?? {};
  const typeMap: Record<string, string> = {
    invalid_request: "invalid_request_error",
    invalid_request_error: "invalid_request_error",
    auth_error: "authentication_error",
    account_banned: "permission_error",
    account_not_activated: "permission_error",
    discord_verification_required: "permission_error",
    insufficient_credits: "invalid_request_error",
    rate_limit: "rate_limit_error",
    server_error: "api_error",
  };
  return {
    type: "error",
    error: {
      type: typeMap[String(err.type)] ?? "api_error",
      message: String(err.message ?? "Unknown error"),
    },
  };
}

// ------------------------ streaming response transform ---------------------

/**
 * Build a TransformStream that converts an OpenAI SSE stream
 * (`chat.completion.chunk` lines + `[DONE]`) into the Anthropic Messages SSE
 * event sequence (message_start / content_block_* / message_delta /
 * message_stop).
 *
 * Anthropic streams content blocks strictly one at a time: a block must be
 * closed (content_block_stop) before the next opens. We track a single open
 * block and switch types as OpenAI deltas arrive (text -> tool_use, etc.).
 */
export function makeOpenAIToAnthropicStreamTransform(
  model: string
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const messageId = genMessageId();

  let buffer = "";
  let started = false;
  let finished = false;

  // Open-block state. blockKind: null (none) | "text" | "thinking" | "tool".
  let blockKind: "text" | "thinking" | "tool" | null = null;
  let blockIndex = -1;
  // Map an OpenAI tool_call array index -> the Anthropic block index we opened.
  const toolIndexMap = new Map<number, number>();

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let stopReason = "end_turn";

  function send(
    controller: TransformStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown
  ) {
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  }

  function ensureStarted(
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    if (started) return;
    started = true;
    send(controller, "message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    });
  }

  function closeOpenBlock(
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    if (blockKind === null) return;
    send(controller, "content_block_stop", {
      type: "content_block_stop",
      index: blockIndex,
    });
    blockKind = null;
  }

  function openTextLike(
    controller: TransformStreamDefaultController<Uint8Array>,
    kind: "text" | "thinking"
  ) {
    if (blockKind === kind) return;
    closeOpenBlock(controller);
    blockIndex += 1;
    blockKind = kind;
    send(controller, "content_block_start", {
      type: "content_block_start",
      index: blockIndex,
      content_block:
        kind === "thinking"
          ? { type: "thinking", thinking: "" }
          : { type: "text", text: "" },
    });
  }

  function handleChunk(
    parsed: any,
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    ensureStarted(controller);

    if (parsed?.usage) {
      const p = Number(parsed.usage.prompt_tokens);
      const c = Number(parsed.usage.completion_tokens);
      if (p > 0) inputTokens = p;
      if (c > 0) outputTokens = c;
      const cr = Number(parsed.usage.cache_read_input_tokens);
      const cw = Number(parsed.usage.cache_creation_input_tokens);
      if (cr > 0) cacheRead = cr;
      if (cw > 0) cacheWrite = cw;
    }

    const choice = parsed?.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};

    // Extended-thinking / reasoning delta.
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      openTextLike(controller, "thinking");
      send(controller, "content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "thinking_delta", thinking: delta.reasoning_content },
      });
    }

    // Regular text delta.
    if (typeof delta.content === "string" && delta.content) {
      openTextLike(controller, "text");
      send(controller, "content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }

    // Tool-call deltas: the first delta for a given index carries id+name; the
    // rest carry `arguments` fragments -> input_json_delta.
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        const oaIndex = Number(call?.index ?? 0);
        if (!toolIndexMap.has(oaIndex)) {
          closeOpenBlock(controller);
          blockIndex += 1;
          blockKind = "tool";
          toolIndexMap.set(oaIndex, blockIndex);
          send(controller, "content_block_start", {
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id: String(call?.id ?? genMessageId()),
              name: String(call?.function?.name ?? ""),
              input: {},
            },
          });
        }
        const args = call?.function?.arguments;
        if (typeof args === "string" && args) {
          send(controller, "content_block_delta", {
            type: "content_block_delta",
            index: toolIndexMap.get(oaIndex)!,
            delta: { type: "input_json_delta", partial_json: args },
          });
        }
      }
    }

    if (typeof choice.finish_reason === "string" && choice.finish_reason) {
      stopReason = mapFinishToStopReason(choice.finish_reason);
    }
  }

  function finish(controller: TransformStreamDefaultController<Uint8Array>) {
    if (finished) return;
    finished = true;
    ensureStarted(controller);
    closeOpenBlock(controller);
    send(controller, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ...(cacheRead > 0 && { cache_read_input_tokens: cacheRead }),
        ...(cacheWrite > 0 && { cache_creation_input_tokens: cacheWrite }),
      },
    });
    send(controller, "message_stop", { type: "message_stop" });
  }

  function flushLines(
    text: string,
    controller: TransformStreamDefaultController<Uint8Array>
  ) {
    buffer += text;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        finish(controller);
        continue;
      }
      try {
        handleChunk(JSON.parse(payload), controller);
      } catch {
        // ignore malformed chunk
      }
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      flushLines(decoder.decode(chunk, { stream: true }), controller);
    },
    flush(controller) {
      flushLines(decoder.decode(), controller);
      finish(controller);
    },
  });
}
