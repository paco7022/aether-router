/**
 * Token estimator fallback for when providers don't return usage data.
 *
 * Uses a word/punctuation-based heuristic instead of naive chars/4, which
 * over-counts when messages contain JSON markup, HTML, or long system prompts.
 *
 * Rule of thumb (from OpenAI docs): ~0.75 words per token for English,
 * so 1 token ≈ 1.33 words. We use a slightly conservative 1.25 to avoid
 * under-charging, but it's far more accurate than chars/4.
 *
 * WARNING: This estimator is used for BILLING when providers omit usage data
 * AND for the pre-flight context cap check. For code-heavy content it can
 * over-count (~2x); for non-English text or minified content it can under-count.
 */

const WORD_SPLIT = /[\s,.!?;:(){}\[\]"'`<>\/\\|@#$%^&*+=~]+/;

// Per-block placeholder costs for non-text content. These are conservative
// upper bounds — the real provider counts may be lower, but the goal of the
// estimator is to PREVENT users from sneaking past the context cap with
// content the heuristic can't see (PDFs, images, base64 blobs).
const TOKENS_PER_IMAGE = 1500;       // ~1.5k for typical 1024px image
const TOKENS_PER_AUDIO_SECOND = 25;
const BASE64_BYTES_PER_TOKEN = 3;    // 1 token ≈ 3 base64 chars for binary docs

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(WORD_SPLIT).filter(Boolean).length;
  const wordBased = Math.ceil(words * 1.33);
  // Character-based floor. The word-split heuristic badly under-counts
  // markdown-heavy prose (JanitorAI RP) and non-space-separated scripts
  // (CJK) because punctuation and whole paragraphs collapse into one
  // "word". chars/3 is a conservative upper bound that still over-counts
  // by ~20% for normal English but prevents the 3x under-count that let
  // Pro users sneak 66k prompts past a 32k cap.
  const charBased = Math.ceil(text.length / 3);
  return Math.max(wordBased, charBased);
}

/**
 * Estimate prompt tokens from the FULL request body, not just messages.
 * Counts: messages, tools/functions, system field (Anthropic style),
 * and assigns placeholder costs for image / document / audio blocks.
 */
export function estimatePromptTokens(
  messagesOrBody:
    | Array<{ role: string; content: unknown }>
    | Record<string, unknown>
): number {
  // Backwards-compat: if caller passed an array, treat it as `body.messages`.
  const body: Record<string, unknown> = Array.isArray(messagesOrBody)
    ? { messages: messagesOrBody }
    : messagesOrBody;

  let total = 0;

  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      total += 4; // per-message overhead
      total += estimateContentTokens(msg.content);
    }
  }

  // Anthropic-style top-level system prompt.
  if (typeof body.system === "string") {
    total += estimateTokens(body.system);
  } else if (Array.isArray(body.system)) {
    total += estimateContentTokens(body.system);
  }

  // OpenAI tools / functions definitions are part of the prompt.
  // Serialized JSON length is a reasonable proxy.
  if (Array.isArray(body.tools)) {
    total += estimateTokens(safeStringify(body.tools));
  }
  if (Array.isArray(body.functions)) {
    total += estimateTokens(safeStringify(body.functions));
  }
  if (body.tool_choice && typeof body.tool_choice === "object") {
    total += estimateTokens(safeStringify(body.tool_choice));
  }

  return total;
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === "string") return estimateTokens(content);
  if (!Array.isArray(content)) return 0;

  let total = 0;
  for (const block of content) {
    if (typeof block === "string") {
      total += estimateTokens(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;

    const b = block as Record<string, unknown>;
    const type = typeof b.type === "string" ? b.type : "";

    // Text blocks
    if (typeof b.text === "string") {
      total += estimateTokens(b.text);
      continue;
    }
    if (typeof b.content === "string") {
      total += estimateTokens(b.content);
      continue;
    }

    // Image blocks (OpenAI: image_url, Anthropic: image)
    if (type === "image_url" || type === "image" || type === "input_image") {
      total += TOKENS_PER_IMAGE;
      continue;
    }

    // Document / PDF blocks (Anthropic) — size based on base64 payload length.
    if (type === "document" || type === "file" || type === "input_file") {
      total += estimateBinaryBlockTokens(b);
      continue;
    }

    // Audio blocks
    if (type === "audio" || type === "input_audio") {
      const seconds = Number(b.duration) || Number((b.input_audio as Record<string, unknown> | undefined)?.duration) || 30;
      total += Math.ceil(seconds * TOKENS_PER_AUDIO_SECOND);
      continue;
    }

    // Tool result / function call blocks — fall back to JSON length.
    if (type === "tool_use" || type === "tool_result" || type === "function_call" || type === "function_response") {
      total += estimateTokens(safeStringify(block));
      continue;
    }

    // Unknown block: best-effort serialize.
    total += estimateTokens(safeStringify(block));
  }
  return total;
}

function estimateBinaryBlockTokens(block: Record<string, unknown>): number {
  const source = block.source as Record<string, unknown> | undefined;
  const data = (source?.data ?? block.data ?? block.file_data) as unknown;
  if (typeof data === "string" && data.length > 0) {
    return Math.ceil(data.length / BASE64_BYTES_PER_TOKEN);
  }
  // Unknown size — assume a small PDF (~10k tokens) as a floor that still
  // trips the cap if a user attaches multiple of them.
  return 10_000;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
