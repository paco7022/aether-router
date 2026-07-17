import { CREDITS_PER_USD, MARGIN } from "./constants";

export interface ModelPricing {
  cost_per_m_input: number;
  cost_per_m_output: number;
  cost_per_m_cache_read?: number;
  cost_per_m_cache_write?: number;
  margin: number;
}

export interface CacheTokens {
  read?: number;
  write?: number;
}

export function calculateCredits(
  promptTokens: number,
  completionTokens: number,
  pricing: ModelPricing,
  cache: CacheTokens = {}
): { credits: number; costUsd: number } {
  const margin = pricing.margin || MARGIN;
  const cacheRead = Math.max(cache.read ?? 0, 0);
  const cacheWrite = Math.max(cache.write ?? 0, 0);

  // OpenAI-compatible providers report prompt_tokens as the full input
  // total (including any cached reads / cache-creation tokens). Subtract
  // them so we don't bill the same token at both input and cache rates.
  const freshPrompt = Math.max(promptTokens - cacheRead - cacheWrite, 0);

  const inputCost      = (freshPrompt       / 1_000_000) * pricing.cost_per_m_input;
  const outputCost     = (completionTokens  / 1_000_000) * pricing.cost_per_m_output;
  const cacheReadCost  = (cacheRead         / 1_000_000) * (pricing.cost_per_m_cache_read  ?? 0);
  const cacheWriteCost = (cacheWrite        / 1_000_000) * (pricing.cost_per_m_cache_write ?? 0);

  const costUsd = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  const costWithMargin = costUsd * margin;
  const credits = Math.ceil(costWithMargin * CREDITS_PER_USD);

  return { credits, costUsd };
}

// Flat per-token billing for enterprise contracts (api_keys.pricing_mode =
// 'flat_per_token'). Every token — prompt + completion, including cached —
// is billed at `ratePerMTokens` USD per 1M tokens. No margin, no cache
// discount: the contract is a flat $/token, so all tokens count equally.
// e.g. rate=3 → 30,000 credits per 1M tokens (CREDITS_PER_USD=10000).
export function flatTokenCredits(
  promptTokens: number,
  completionTokens: number,
  ratePerMTokens: number
): { credits: number; costUsd: number } {
  const tokens = Math.max(promptTokens, 0) + Math.max(completionTokens, 0);
  const costUsd = (tokens / 1_000_000) * ratePerMTokens;
  return { credits: Math.ceil(costUsd * CREDITS_PER_USD), costUsd };
}

// Pay-as-you-go pricing for a premium model (profiles.billing_mode = 'payg').
//
// The two rates are stored on the model row as CREDITS per 1M tokens and are a
// SELLING price — the margin is already baked in by whoever set them. So there
// is deliberately no margin multiplier and no CREDITS_PER_USD conversion here:
// the number in the column is the number of credits charged.
//
// Cached tokens get no discount: premium upstreams are flat-quota resellers, so
// a cache read costs us the same as a fresh one.
//
// IMPORTANT — pass OUR OWN token counts, never the upstream's reported usage.
// Premium resellers inflate the input side by injecting their own system prompt
// (blaze reports ~1.3k prompt_tokens for a trivial "2+2"; orbit omits its ~4k
// Kiro preamble). Billing PAYG off that would charge users for tokens they
// never sent. Mirrors the visible-token rule already used for enterprise
// flat_per_token keys.
export interface PaygPricing {
  payg_credits_per_m_input: number;
  payg_credits_per_m_output: number;
}

export function paygCredits(
  promptTokens: number,
  completionTokens: number,
  pricing: PaygPricing
): { credits: number; costUsd: number } {
  const prompt = Math.max(promptTokens, 0);
  const completion = Math.max(completionTokens, 0);

  const credits =
    (prompt / 1_000_000) * (pricing.payg_credits_per_m_input || 0) +
    (completion / 1_000_000) * (pricing.payg_credits_per_m_output || 0);

  // Never settle a served request at 0 credits.
  const billed = Math.max(Math.ceil(credits), 1);
  return { credits: billed, costUsd: creditsToUsd(billed) };
}

// True when a model is offered on pay-as-you-go at all (both rates seeded).
export function isPaygPriced(pricing: Partial<PaygPricing> | null | undefined): boolean {
  return (
    !!pricing &&
    Number(pricing.payg_credits_per_m_input) > 0 &&
    Number(pricing.payg_credits_per_m_output) > 0
  );
}

export function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD;
}

export function usdToCredits(usd: number): number {
  return Math.ceil(usd * CREDITS_PER_USD);
}

export function formatCredits(credits: number): string {
  return credits.toLocaleString();
}

export function pricePerMTokens(costPerM: number, margin: number = MARGIN): number {
  return Math.ceil(costPerM * margin * CREDITS_PER_USD);
}
