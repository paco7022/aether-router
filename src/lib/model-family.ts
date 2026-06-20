// Classify a model into its underlying vendor/family (Anthropic, Google, ...)
// from its display name / id. This is purely cosmetic for the Models page
// grouping & filtering — the same family (e.g. Claude) can be served through
// several of our internal providers (t/, or/, h/, ...). Routing is unaffected.

export type ModelFamily = { key: string; label: string; color: string };

const RULES: { match: RegExp; family: ModelFamily }[] = [
  { match: /claude/,                          family: { key: "anthropic", label: "Anthropic",     color: "rgba(217, 119, 87, 0.95)" } },
  { match: /gemini|gemma|palm|bison/,         family: { key: "google",    label: "Google",        color: "rgba(66, 133, 244, 0.95)" } },
  { match: /gpt|openai|chatgpt|\bo[1-9]\b/,   family: { key: "openai",    label: "OpenAI",        color: "rgba(16, 163, 127, 0.95)" } },
  { match: /deepseek/,                        family: { key: "deepseek",  label: "DeepSeek",      color: "rgba(77, 107, 254, 0.95)" } },
  { match: /grok/,                            family: { key: "xai",       label: "xAI",           color: "rgba(190, 195, 210, 0.95)" } },
  { match: /\bglm\b|z-ai|chatglm/,            family: { key: "zai",       label: "Z.AI",          color: "rgba(34, 211, 238, 0.95)" } },
  { match: /kimi|moonshot/,                   family: { key: "moonshot",  label: "Moonshot AI",   color: "rgba(139, 92, 246, 0.95)" } },
  { match: /minimax/,                         family: { key: "minimax",   label: "MiniMax",       color: "rgba(236, 72, 153, 0.95)" } },
  { match: /qwen|qwq/,                        family: { key: "alibaba",   label: "Alibaba",       color: "rgba(124, 92, 255, 0.95)" } },
  { match: /nemotron|nvidia/,                 family: { key: "nvidia",    label: "NVIDIA",        color: "rgba(118, 185, 0, 0.95)" } },
  { match: /mimo|xiaomi/,                     family: { key: "xiaomi",    label: "Xiaomi",        color: "rgba(255, 105, 0, 0.95)" } },
  { match: /hermes|nous/,                     family: { key: "nous",      label: "Nous Research", color: "rgba(148, 163, 184, 0.95)" } },
  { match: /llama|meta/,                      family: { key: "meta",      label: "Meta",          color: "rgba(6, 104, 225, 0.95)" } },
  { match: /mistral|mixtral|magistral|codestral|ministral/, family: { key: "mistral", label: "Mistral", color: "rgba(255, 112, 0, 0.95)" } },
];

const OTHER: ModelFamily = { key: "other", label: "Other", color: "rgba(148, 163, 184, 0.8)" };

// Display order for family sections / filter chips.
export const FAMILY_ORDER = [
  "anthropic", "google", "openai", "deepseek", "xai", "zai",
  "moonshot", "minimax", "alibaba", "nvidia", "xiaomi", "nous",
  "meta", "mistral", "other",
];

export function classifyFamily(displayName: string, id: string): ModelFamily {
  const hay = `${displayName} ${id}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.test(hay)) return rule.family;
  }
  return OTHER;
}
