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

const TROLLLM_CONTEXT_BASE_TOKENS = 32_000;
const TROLLLM_CONTEXT_SURCHARGE_TOKENS = 10_000;
const TROLLLM_CONTEXT_SURCHARGE_COST = 2;

export function getContextAdjustedPremiumRequestCost(
  modelId: string,
  provider: string | null | undefined,
  baseCost: number,
  contextTokens: number
): number {
  if (provider !== "trolllm" && !modelId.startsWith("t/")) return baseCost;
  if (!Number.isFinite(contextTokens) || contextTokens <= TROLLLM_CONTEXT_BASE_TOKENS) {
    return baseCost;
  }

  const surchargeBands = Math.ceil(
    (contextTokens - TROLLLM_CONTEXT_BASE_TOKENS) / TROLLLM_CONTEXT_SURCHARGE_TOKENS
  );
  return baseCost + (surchargeBands * TROLLLM_CONTEXT_SURCHARGE_COST);
}
