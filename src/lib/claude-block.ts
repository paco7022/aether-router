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
// kiro removed 2026-08-21: the free tier was discontinued platform-wide, so k/
// is paid-users-only like or/ and at/. It stays in CLAUDE_ACTIVATION_BYPASS —
// paid plans route without an admin flipping claude_activated per user.
const CLAUDE_PAID_ONLY_BYPASS = new Set(["trolllm", "zenllm"]);

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
// kiro (2026-08-21): same posture as atessa — paid-only, no per-user flip.
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

// Anthropic direct (ad/, provider "anthropic"): the real official API, called
// with our own personal key. Deliberately kept OUT of
// ALLOWED_CLAUDE_PROVIDERS/CLAUDE_PAID_ONLY_BYPASS/CLAUDE_ACTIVATION_BYPASS —
// the normal paid-plan + claude_activated rule must NEVER grant access here,
// unlike every other Claude provider above. The only door in is a custom key
// (hand-minted, one per approved person) whose allowed_providers explicitly
// lists "anthropic". Checked in chat/completions/route.ts as a special case
// of the Claude gate, before isAllowedClaudeProvider is even consulted.
export function isAnthropicDirectAllowed(keyInfo: {
  isCustom: boolean;
  allowedProviders: string[] | null;
}): boolean {
  return (
    keyInfo.isCustom &&
    Array.isArray(keyInfo.allowedProviders) &&
    keyInfo.allowedProviders.includes("anthropic")
  );
}
