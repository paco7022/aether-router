// Claude policy gate. Anthropic policy change → most Claude routes are
// blocked entirely. Only providers whose owners explicitly approved Claude
// routing are allowed, and only for paid plans.
//
// To revert: remove the call site in /api/v1/chat/completions/route.ts.

export const CLAUDE_BLOCK_MESSAGE =
  "Sorry, access to this model requires admin approval first. Contact an admin on Discord.";

export const CLAUDE_PAID_ONLY_MESSAGE =
  "Claude models are restricted to paid plans. Upgrade your plan to use them.";

export const CLAUDE_NOT_ACTIVATED_MESSAGE =
  "Your account is not yet activated for Claude. Message an admin on Discord to request activation.";

// Providers currently approved to route Claude requests.
const ALLOWED_CLAUDE_PROVIDERS = new Set(["trolllm", "gameron", "dlab", "riftai", "hapuppy"]);

// Providers whose Claude routing bypasses the paid-plan-only rule.
// trolllm: free users can use Claude on t/ once admin flips
// profiles.claude_activated; the per-user gate replaces the
// paid-plan-only rule for this provider.
const CLAUDE_PAID_ONLY_BYPASS = new Set(["trolllm"]);

export function claudePaidOnlyApplies(provider: string | null | undefined): boolean {
  return !!provider && !CLAUDE_PAID_ONLY_BYPASS.has(provider);
}

export function isClaudeModel(model: {
  id?: string | null;
  upstream_model_id?: string | null;
  provider?: string | null;
}): boolean {
  const id = (model.id ?? "").toLowerCase();
  const upstream = (model.upstream_model_id ?? "").toLowerCase();
  return id.includes("claude") || upstream.includes("claude");
}

export function isAllowedClaudeProvider(provider: string | null | undefined): boolean {
  return !!provider && ALLOWED_CLAUDE_PROVIDERS.has(provider);
}
