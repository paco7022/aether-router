// Claude policy gate. Anthropic policy change → most Claude routes are
// blocked entirely. Trolllm (`t/`) is the only provider whose owner has
// approved continued Claude routing, and only for paid plans.
//
// To revert: remove the call site in /api/v1/chat/completions/route.ts.

export const CLAUDE_BLOCK_MESSAGE =
  "Sorry, access to this model requires admin approval first. Contact an admin on Discord.";

export const CLAUDE_PAID_ONLY_MESSAGE =
  "Claude models are restricted to paid plans. Upgrade your plan to use them.";

// The only provider currently allowed to route Claude requests.
const ALLOWED_CLAUDE_PROVIDER = "trolllm";

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
  return provider === ALLOWED_CLAUDE_PROVIDER;
}
