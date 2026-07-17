import { describe, it, expect } from "vitest";
import { paygCredits, isPaygPriced } from "../src/lib/credits";

// Opus/GPT tier — the owner-set reference prices.
const OPUS = { payg_credits_per_m_input: 2000, payg_credits_per_m_output: 30000 };
const GLM = { payg_credits_per_m_input: 300, payg_credits_per_m_output: 2000 };

describe("paygCredits", () => {
  it("charges the column value verbatim — no margin, no USD conversion", () => {
    // Exactly 1M in + 1M out on the Opus tier = 2000 + 30000.
    expect(paygCredits(1_000_000, 1_000_000, OPUS).credits).toBe(32_000);
  });

  it("prices a typical RP turn (20k context, 500 out)", () => {
    // 20000/1e6*2000 = 40 ; 500/1e6*30000 = 15 → 55
    expect(paygCredits(20_000, 500, OPUS).credits).toBe(55);
  });

  it("scales with context — the point of uncapped PAYG", () => {
    // 200k context is 10x the 20k turn on the input side.
    expect(paygCredits(200_000, 0, OPUS).credits).toBe(400);
  });

  it("applies per-family tiers independently", () => {
    expect(paygCredits(1_000_000, 1_000_000, GLM).credits).toBe(2_300);
  });

  it("rounds up — a served request never settles free", () => {
    // 1 token of input is a fraction of a credit; must still bill 1.
    expect(paygCredits(1, 0, OPUS).credits).toBe(1);
    expect(paygCredits(0, 0, OPUS).credits).toBe(1);
  });

  it("ignores negative token counts rather than crediting the user", () => {
    expect(paygCredits(-5000, -5000, OPUS).credits).toBe(1);
  });

  it("reports costUsd consistent with the credit total", () => {
    const { credits, costUsd } = paygCredits(1_000_000, 1_000_000, OPUS);
    expect(credits).toBe(32_000);
    expect(costUsd).toBeCloseTo(3.2, 5); // CREDITS_PER_USD = 10_000
  });

  it("treats a missing rate as zero rather than NaN", () => {
    const partial = { payg_credits_per_m_input: 2000, payg_credits_per_m_output: 0 };
    // Output side contributes nothing; input 1M = 2000.
    expect(paygCredits(1_000_000, 5_000_000, partial).credits).toBe(2000);
  });
});

describe("isPaygPriced", () => {
  it("requires both rates to be seeded", () => {
    expect(isPaygPriced(OPUS)).toBe(true);
    expect(isPaygPriced({ payg_credits_per_m_input: 0, payg_credits_per_m_output: 0 })).toBe(false);
    // na/ + ds/ are excluded from PAYG by leaving the columns at 0.
    expect(isPaygPriced({ payg_credits_per_m_input: 2000, payg_credits_per_m_output: 0 })).toBe(false);
    expect(isPaygPriced(null)).toBe(false);
    expect(isPaygPriced(undefined)).toBe(false);
  });
});
