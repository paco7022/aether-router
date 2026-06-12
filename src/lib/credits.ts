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
