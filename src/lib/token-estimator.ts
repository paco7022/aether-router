/**
 * Simple token estimator for when providers don't return usage data.
 * Uses ~4 chars per token approximation (conservative).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimatePromptTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens for message overhead (role, formatting)
    total += 4;
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    }
  }
  return total;
}
