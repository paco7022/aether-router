export type PreflightError = {
  status: number;
  payload: Record<string, unknown>;
};

export function isApiKeyAuthHeader(authHeader: string | null): boolean {
  return typeof authHeader === "string" && authHeader.startsWith("Bearer ");
}

export function getRequestFingerprint(headers: Headers): string | null {
  const direct = headers.get("x-device-fingerprint") || headers.get("x-fingerprint");
  if (!direct) return null;
  const cleaned = direct.trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function getCustomKeyNoCreditsError(customCredits: number | null): PreflightError | null {
  if (customCredits === null || customCredits > 0) return null;
  return {
    status: 402,
    payload: {
      error: {
        message: "This key has no credits remaining.",
        type: "billing_error",
        credits_available: 0,
      },
    },
  };
}

export function getNoPaidBalanceError(isFreePool: boolean, credits: number, dailyCredits: number): PreflightError | null {
  if (isFreePool) return null;
  if ((credits + dailyCredits) > 0) return null;

  return {
    status: 402,
    payload: {
      error: {
        message: "Insufficient credits",
        type: "billing_error",
        credits_required: 1,
        credits_available: 0,
      },
    },
  };
}

// Context surcharge for premium models whose upstream bills us PER TOKEN.
// The stored `premium_request_cost` buys the first CONTEXT_SURCHARGE_BASE_TOKENS
// of prompt (32k = the cheapest paid plan's context cap, which is what the
// price was computed against); every extra band of 10k input tokens costs us
// real money upstream, so it adds `surchargePer10k` premium requests on top.
//
// Without this, a Max/Ultimate account (128k-200k context cap) would pay the
// same premium requests as a Pro account at 32k while costing us 4-6x more.
//
// Per-model rate lives in `models.context_surcharge_per_10k` (provider price
// per 10k input tokens x margin / revenue-per-premium-request). t/ (trolllm)
// predates the column and keeps its hardcoded flat +2/band as the fallback.
export const CONTEXT_SURCHARGE_BASE_TOKENS = 32_000;
export const CONTEXT_SURCHARGE_BAND_TOKENS = 10_000;
const TROLLLM_CONTEXT_SURCHARGE_COST = 2;

export function getContextAdjustedPremiumRequestCost(
  modelId: string,
  provider: string | null | undefined,
  baseCost: number,
  contextTokens: number,
  surchargePer10k?: number | null
): number {
  const configured = Number(surchargePer10k);
  const perBand =
    Number.isFinite(configured) && configured > 0
      ? configured
      : provider === "trolllm" || modelId.startsWith("t/")
      ? TROLLLM_CONTEXT_SURCHARGE_COST
      : 0;

  if (perBand <= 0) return baseCost;
  if (!Number.isFinite(contextTokens) || contextTokens <= CONTEXT_SURCHARGE_BASE_TOKENS) {
    return baseCost;
  }

  const surchargeBands = Math.ceil(
    (contextTokens - CONTEXT_SURCHARGE_BASE_TOKENS) / CONTEXT_SURCHARGE_BAND_TOKENS
  );
  // Rounded to 2 decimals: the cost lands in NUMERIC columns (premium counter,
  // usage_logs.premium_cost) and fractional rates would otherwise drag a long
  // float tail through them.
  return Math.round((baseCost + surchargeBands * perBand) * 100) / 100;
}
