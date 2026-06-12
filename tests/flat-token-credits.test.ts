import { describe, expect, it } from "vitest";
import { flatTokenCredits } from "../src/lib/credits";

// flatTokenCredits powers enterprise per-token billing (api_keys.pricing_mode =
// 'flat_per_token'). Every token (prompt + completion) is billed at a flat
// $/1M rate against custom_credits — no margin, no cache discount.
// CREDITS_PER_USD = 10000, so rate=3 → 30,000 credits per 1M tokens.

describe("flatTokenCredits", () => {
  it("charges exactly 30,000 credits per 1M tokens at $3/M", () => {
    const { credits, costUsd } = flatTokenCredits(700_000, 300_000, 3);
    expect(credits).toBe(30_000); // 1M tokens * $3/M * 10000 credits/$
    expect(costUsd).toBeCloseTo(3, 9);
  });

  it("counts prompt + completion equally", () => {
    // 500k prompt + 500k completion = 1M tokens → same as above.
    expect(flatTokenCredits(500_000, 500_000, 3).credits).toBe(30_000);
  });

  it("ceils sub-credit fractions (never undercharge)", () => {
    // 1 token at $3/M = 0.00003 credits → ceil to 1.
    expect(flatTokenCredits(1, 0, 3).credits).toBe(1);
  });

  it("scales linearly with the rate", () => {
    expect(flatTokenCredits(1_000_000, 0, 1).credits).toBe(10_000);
    expect(flatTokenCredits(1_000_000, 0, 6).credits).toBe(60_000);
  });

  it("clamps negative token counts to zero", () => {
    expect(flatTokenCredits(-100, -50, 3).credits).toBe(0);
  });
});
