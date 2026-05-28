function getPrefix(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.startsWith("g/") || lower.startsWith("gemini")) return "g";
  if (lower.startsWith("o/") || lower.startsWith("openai") || lower.startsWith("gpt")) return "o";
  if (lower.startsWith("an/") || lower.startsWith("c/") || lower.startsWith("claude") || lower.startsWith("anthropic")) return "c";
  if (lower.startsWith("gm/")) return "c";
  if (lower.startsWith("x/") || lower.startsWith("grok") || lower.startsWith("xai")) return "x";
  if (lower.startsWith("m/") || lower.startsWith("mistral")) return "m";
  if (lower.startsWith("w/")) return "w";
  if (lower.startsWith("t/")) return "w";
  if (lower.startsWith("or/")) {
    // Orbit serves multiple model families; classify by sub-id so the
    // avatar matches the underlying model. Default to a generic "w"
    // tile when nothing more specific applies.
    const rest = lower.slice(3);
    if (rest.startsWith("claude")) return "c";
    if (rest.startsWith("gpt") || rest.startsWith("openai")) return "o";
    if (rest.startsWith("gemini")) return "g";
    if (rest.startsWith("grok") || rest.startsWith("xai")) return "x";
    return "w";
  }
  return "default";
}

function getInitial(modelId: string): string {
  const clean = modelId.replace(/^[a-z]+\//, "");
  const ch = clean.charAt(0);
  return (ch || "?").toUpperCase();
}

export function ModelAvatar({ modelId, size = 28 }: { modelId: string; size?: number }) {
  const prefix = getPrefix(modelId);
  const initial = getInitial(modelId);
  return (
    <span
      className={`model-avatar ${prefix}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
      title={modelId}
    >
      {initial}
    </span>
  );
}
