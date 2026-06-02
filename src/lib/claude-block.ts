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
const ALLOWED_CLAUDE_PROVIDERS = new Set(["trolllm", "gameron", "dlab", "riftai", "hapuppy", "orbit"]);

// Providers whose Claude routing bypasses the paid-plan-only rule.
// trolllm + orbit: free users can use Claude here once admin flips
// profiles.claude_activated; the per-user gate replaces the
// paid-plan-only rule for these providers.
const CLAUDE_PAID_ONLY_BYPASS = new Set(["trolllm", "orbit"]);

// Providers whose Claude routing also bypasses the per-user
// profiles.claude_activated gate. Use sparingly — this turns Claude
// access into "anyone with an activated API key can route", with no
// admin opt-in per user.
//
// orbit: upstream is a flat-rate Kiro Pro subscription (not pay-as-you-
// go), so per-user fairness is not load-bearing. Standard premium-pool
// + context-cap enforcement is enough.
//
// trolllm (2026-06-02): capacity increased, so t/ is open to everyone —
// free plan included — with no admin activation needed. Still costs the
// normal premium-request price (Opus = 6, Sonnet = 3) from the user's
// premium pool + overage; only the per-user activation gate is lifted.
const CLAUDE_ACTIVATION_BYPASS = new Set(["orbit", "trolllm"]);

export function claudePaidOnlyApplies(provider: string | null | undefined): boolean {
  return !!provider && !CLAUDE_PAID_ONLY_BYPASS.has(provider);
}

export function claudeActivationApplies(provider: string | null | undefined): boolean {
  return !!provider && !CLAUDE_ACTIVATION_BYPASS.has(provider);
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
