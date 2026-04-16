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
 * WARNING: This estimator is used for BILLING when providers omit usage data.
 * For code-heavy content it can over-count (~2x); for non-English text or
 * minified content it can under-count. If billing accuracy is critical,
 * consider integrating tiktoken (for OpenAI models) or the provider's own
 * token counting API instead of relying on this heuristic.
 */

// Regex: split on whitespace and common punctuation boundaries
const WORD_SPLIT = /[\s,.!?;:(){}\[\]"'`<>\/\\|@#$%^&*+=~]+/;

export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count "words" — sequences of non-whitespace/punctuation
  const words = text.split(WORD_SPLIT).filter(Boolean).length;

  // ~1.33 tokens per word for English (OpenAI heuristic).
  // For non-English or code, this is still closer than chars/4.
  return Math.ceil(words * 1.33);
}

export function estimatePromptTokens(
  messages: Array<{ role: string; content: unknown }>
): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens for message overhead (role, formatting)
    total += 4;

    const text = extractTextFromContent(msg.content);
    total += estimateTokens(text);
  }
  return total;
}

/**
 * Extract plain text from message content, handling both string and
 * array-of-blocks formats (Anthropic / OpenAI multimodal).
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          // OpenAI / Anthropic text blocks
          if ("text" in block && typeof (block as { text: unknown }).text === "string") {
            return (block as { text: string }).text;
          }
          // Some frontends send {type:"text", content:"..."}
          if ("content" in block && typeof (block as { content: unknown }).content === "string") {
            return (block as { content: string }).content;
          }
        }
        return "";
      })
      .join(" ");
  }

  return "";
}
