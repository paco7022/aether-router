// Free tier removal (2026-08-21) + pay-as-you-go access.
//
// The `free` plan no longer routes on its own. There are two doors into the
// router now, and `isPaidAccount()` is the single definition of "this account
// pays":
//
//   1. a paid plan (plan_id !== 'free'), or
//   2. purchased credits — `profiles.is_paid` (set by a Stripe purchase or a
//      received gift) while the permanent balance holds at least
//      MIN_PAID_CREDITS. Those accounts bill per token (billing_mode='payg');
//      per-request billing needs a plan's premium pool, which they don't have.
//
// is_paid is maintained by DB triggers (migration
// 20260821140000_paid_credits_access.sql), so it can never be true below the
// floor no matter which code path moved the balance. The floor is re-checked
// here anyway: keyInfo already carries the balance, so it costs nothing and
// covers the window between a settlement and the trigger.
//
// Custom keys are exempt from all of this — admin-minted, own credit pool.
//
// Keep this module free of server-only imports: the dashboard banner is a
// client component and imports MIN_PAID_CREDITS from here.
//
// To revert: drop the `isFreeTierBlocked()` call sites in
// `src/app/api/v1/chat/completions/route.ts` and `src/lib/media-auth.ts`,
// and flip `plans.is_active` back to true for `free`.

// Permanent credits an account must hold for purchased-credit access to stay
// live. Mirrors the floor enforced by enforce_is_paid_credit_floor() in the DB
// — change both together.
export const MIN_PAID_CREDITS = 100;

export const FREE_TIER_REMOVED_MESSAGE =
  `The free tier has been discontinued. Subscribe to a plan, or buy credits (at least ${MIN_PAID_CREDITS}) to route pay-as-you-go, at /dashboard/billing.`;

export type PaidAccountInfo = {
  planId: string;
  isCustom: boolean;
  isPaid?: boolean;
  credits?: number;
};

/** True when the account may route: paid plan, purchased credits, or custom key. */
export function isPaidAccount(keyInfo: PaidAccountInfo): boolean {
  if (keyInfo.isCustom) return true;
  if (keyInfo.planId !== "free") return true;
  return !!keyInfo.isPaid && (keyInfo.credits ?? 0) >= MIN_PAID_CREDITS;
}

export function isFreeTierBlocked(keyInfo: PaidAccountInfo): boolean {
  return !isPaidAccount(keyInfo);
}

/** Body + status for the 402 every routing path returns to a non-paying account. */
export const FREE_TIER_BLOCKED_PAYLOAD = {
  error: {
    message: FREE_TIER_REMOVED_MESSAGE,
    type: "free_tier_discontinued",
  },
} as const;

export const FREE_TIER_BLOCKED_STATUS = 402;
