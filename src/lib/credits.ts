import { CREDITS_PER_USD, MARGIN } from "./constants";

export interface ModelPricing {
  cost_per_m_input: number;
  cost_per_m_output: number;
  margin: number;
}

export function calculateCredits(
  promptTokens: number,
  completionTokens: number,
  pricing: ModelPricing
): { credits: number; costUsd: number } {
  const margin = pricing.margin || MARGIN;
  const inputCost = (promptTokens / 1_000_000) * pricing.cost_per_m_input;
  const outputCost = (completionTokens / 1_000_000) * pricing.cost_per_m_output;
  const costUsd = inputCost + outputCost;
  const costWithMargin = costUsd * margin;
  const credits = Math.ceil(costWithMargin * CREDITS_PER_USD);

  return { credits, costUsd };
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
