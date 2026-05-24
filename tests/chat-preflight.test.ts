import { describe, expect, it } from "vitest";
import {
  getContextAdjustedPremiumRequestCost,
  getCustomKeyNoCreditsError,
  getNoPaidBalanceError,
  getRequestFingerprint,
  isApiKeyAuthHeader,
} from "../src/lib/chat-preflight";

describe("chat preflight", () => {
  it("detects API key auth header", () => {
    expect(isApiKeyAuthHeader("Bearer ak_123")).toBe(true);
    expect(isApiKeyAuthHeader("bearer ak_123")).toBe(false);
    expect(isApiKeyAuthHeader(null)).toBe(false);
  });

  it("extracts fingerprint from headers", () => {
    const h1 = new Headers({ "x-device-fingerprint": "  fp-abc  " });
    expect(getRequestFingerprint(h1)).toBe("fp-abc");

    const h2 = new Headers({ "x-fingerprint": "fp-fallback" });
    expect(getRequestFingerprint(h2)).toBe("fp-fallback");

    const h3 = new Headers();
    expect(getRequestFingerprint(h3)).toBeNull();
  });

  it("rejects exhausted custom key credits", () => {
    expect(getCustomKeyNoCreditsError(0)?.status).toBe(402);
    expect(getCustomKeyNoCreditsError(-1)?.status).toBe(402);
    expect(getCustomKeyNoCreditsError(1)).toBeNull();
    expect(getCustomKeyNoCreditsError(null)).toBeNull();
  });

  it("rejects paid requests when credits are exhausted", () => {
    expect(getNoPaidBalanceError(false, 0, 0)?.status).toBe(402);
    expect(getNoPaidBalanceError(false, 1, 0)).toBeNull();
    expect(getNoPaidBalanceError(false, 0, 1)).toBeNull();
    expect(getNoPaidBalanceError(true, 0, 0)).toBeNull();
  });

  it("adds t/ premium request cost by context band", () => {
    expect(getContextAdjustedPremiumRequestCost("t/claude-opus-4.7", "trolllm", 6, 32_000)).toBe(6);
    expect(getContextAdjustedPremiumRequestCost("t/claude-opus-4.7", "trolllm", 6, 32_001)).toBe(8);
    expect(getContextAdjustedPremiumRequestCost("t/claude-opus-4.7", "trolllm", 6, 42_000)).toBe(8);
    expect(getContextAdjustedPremiumRequestCost("t/claude-opus-4.7", "trolllm", 6, 42_001)).toBe(10);
  });

  it("does not add context premium cost to non-t models", () => {
    expect(getContextAdjustedPremiumRequestCost("r/claude-opus-4-7", "riftai", 7, 200_000)).toBe(7);
  });
});
