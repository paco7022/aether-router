// Claude policy gate. Anthropic policy change → most Claude routes are
// blocked entirely. Only providers whose owners explicitly approved Claude
// routing are allowed, and only for paid plans.
//
// To revert: remove the call site in /api/v1/chat/completions/route.ts.

export const CLAUDE_BLOCK_MESSAGE =
  "Sorry, access to this model requires admin approval first. Contact an admin on Discord.";

export const CLAUDE_PAID_ONLY_MESSAGE =
  "Claude models are restricted to paid plans. Upgrade your plan to use them.";

// DLab is gated per-user via profiles.dlab_approved (admin panel).
// Plan tier does not matter — even free users can be opted in.
export const DLAB_NOT_APPROVED_MESSAGE =
  "DLab models require admin approval per account. Contact an admin on Discord to request access.";

// Providers currently approved to route Claude requests.
//
// dlab is in the allowlist so the generic Claude paid-only check below
// doesn't trip; the dlab-specific gate is the dlab_approved flag,
// enforced separately in the route handler.
const ALLOWED_CLAUDE_PROVIDERS = new Set(["trolllm", "gameron", "dlab"]);

// Providers whose Claude routing bypasses CLAUDE_PAID_ONLY_MESSAGE.
// dlab uses a per-user admin approval gate instead of plan tier, so the
// blanket "free plan can't use Claude" rule does not apply here.
const CLAUDE_PAID_ONLY_BYPASS = new Set(["dlab"]);

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
