import { describe, expect, it } from "vitest";
import {
  capCompletionTokens,
  COMPLETION_TOKEN_CAP_MULTIPLIER,
  COMPLETION_TOKEN_CAP_SLACK,
} from "../src/lib/token-estimator";

// capCompletionTokens is the mirror of floorPromptTokens: the floor stops an
// upstream from under-reporting (which would let it drain credits while we
// bill nothing), this stops the over-reporting that bills the CUSTOMER for
// output that was never generated. Motivating case: or/ (Orbit) has been
// measured reporting 4-9x the real completion. Harmless while premium billing
// was a flat per-request cost, real money under billing_mode='payg' and on
// per-token providers (ds/, na/).

const ceilingFor = (observed: number) =>
  Math.ceil(observed * COMPLETION_TOKEN_CAP_MULTIPLIER) + COMPLETION_TOKEN_CAP_SLACK;

describe("capCompletionTokens", () => {
  it("clamps an absurdly inflated completion to the ceiling", () => {
    // Orbit-style 9x inflation over 1000 tokens of text we actually streamed.
    expect(capCompletionTokens(9000, 1000)).toBe(ceilingFor(1000));
  });

  it("leaves an honest report untouched", () => {
    // Upstream tokenizer differs slightly from o200k — well inside the margin.
    expect(capCompletionTokens(1050, 1000)).toBe(1050);
  });

  it("allows hidden reasoning tokens well above the visible text", () => {
    // A thinking model bills tokens that never appear as content; 2.5x the
    // visible answer must still go through.
    expect(capCompletionTokens(2500, 1000)).toBe(2500);
  });

  it("does not raise an under-report (that is the floor's job)", () => {
    expect(capCompletionTokens(10, 1000)).toBe(10);
  });

  it("is a no-op when no text was observed (e.g. tool-call-only reply)", () => {
    expect(capCompletionTokens(5000, 0)).toBe(5000);
  });

  it("keeps short replies from being clamped by rounding", () => {
    // 1 token of visible text must not cap a small reasoning burst at ~3.
    expect(capCompletionTokens(60, 1)).toBe(60);
  });

  it("coerces non-finite inputs safely", () => {
    expect(capCompletionTokens(NaN, 1000)).toBe(0);
    expect(capCompletionTokens(1000, NaN)).toBe(1000);
  });
});
