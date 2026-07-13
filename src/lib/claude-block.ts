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
// shoot (2026-07-09): sh/ reseller serves real Claude (Opus 4.6-4.8). Approved
// to route Claude. Kept OUT of the paid-only + activation bypass sets, so it
// behaves like riftai/dlab: paid plans + per-user claude_activated (custom keys
// bypass activation via their own controls).
// blaze (2026-07-13): bl/ reseller serves real Claude (Opus 4.5-4.8 + Sonnet
// 4.6/5, incl. -thinking variants). Approved to route Claude. Kept OUT of the
// paid-only + activation bypass sets, so it behaves like shoot/riftai/dlab:
// paid plans + per-user claude_activated (custom keys bypass via their own).
const ALLOWED_CLAUDE_PROVIDERS = new Set(["trolllm", "gameron", "dlab", "riftai", "hapuppy", "orbit", "zenllm", "kiro", "atessa", "shoot", "blaze"]);

// Providers whose Claude routing bypasses the paid-plan-only rule.
// trolllm: free users can use Claude here once admin flips
// profiles.claude_activated; the per-user gate replaces the
// paid-plan-only rule for these providers.
// orbit removed 2026-07-03: or/ is now paid-users-only (no free access).
// kiro (2026-07-10): k/ became a community pool — any user (free included) can
// contribute a Kiro account and everyone uses the pool. Opened to free at a
// 0.5 premium-request price; free access is the whole point, so it bypasses
// both the paid-only rule and the per-user activation gate.
const CLAUDE_PAID_ONLY_BYPASS = new Set(["trolllm", "zenllm", "kiro"]);

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
// zenllm (2026-06-23): launched as a free promo open to everyone (paid =
// unlimited context, free = 32k), same posture as t/ — no paid-plan-only
// rule and no per-user activation gate. Gated only by ZENLLM_FREE_UNLIMITED
// + context cap in the route. Tighten both sets when the promo ends.
// atessa (2026-07-03): paid-users-only (kept OUT of CLAUDE_PAID_ONLY_BYPASS so
// free users are blocked); added here so paid users route without needing a
// per-user claude_activated flip.
const CLAUDE_ACTIVATION_BYPASS = new Set(["orbit", "trolllm", "zenllm", "atessa", "kiro"]);

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
