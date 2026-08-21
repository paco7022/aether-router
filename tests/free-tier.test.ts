import { describe, it, expect } from "vitest";
import { isPaidAccount, isFreeTierBlocked, MIN_PAID_CREDITS } from "@/lib/free-tier";

const base = { planId: "free", isCustom: false, isPaid: false, credits: 0 };

describe("isPaidAccount", () => {
  it("blocks a free account with no purchase", () => {
    expect(isPaidAccount(base)).toBe(false);
    expect(isFreeTierBlocked(base)).toBe(true);
  });

  it("allows any paid plan regardless of balance", () => {
    expect(isPaidAccount({ ...base, planId: "pro" })).toBe(true);
    expect(isPaidAccount({ ...base, planId: "max", credits: 0 })).toBe(true);
  });

  it("allows a free account that bought credits and holds the floor", () => {
    expect(isPaidAccount({ ...base, isPaid: true, credits: MIN_PAID_CREDITS })).toBe(true);
  });

  it("blocks a pay-as-you-go account once it falls under the floor", () => {
    expect(isPaidAccount({ ...base, isPaid: true, credits: MIN_PAID_CREDITS - 1 })).toBe(false);
  });

  it("blocks credits without a purchase (admin grants do not unlock access)", () => {
    expect(isPaidAccount({ ...base, isPaid: false, credits: 100_000 })).toBe(false);
  });

  it("never blocks custom keys", () => {
    expect(isPaidAccount({ ...base, isCustom: true })).toBe(true);
  });

  it("treats missing is_paid/credits as not paying", () => {
    expect(isPaidAccount({ planId: "free", isCustom: false })).toBe(false);
  });
});
