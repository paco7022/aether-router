// Free tier removal (2026-08-21).
//
// The `free` plan no longer routes anything: no API keys, no dashboard chat,
// no media jobs. Existing free accounts keep their profile, credits and
// history, but every routing path answers 402 until they subscribe to a paid
// plan. Custom keys are exempt — they are admin-minted and carry their own
// credit pool, independent of the plan on the profile.
//
// To revert: stop calling `freeTierBlockedResponse()` in
// `src/app/api/v1/chat/completions/route.ts` and `src/lib/media-auth.ts`,
// and flip `plans.is_active` back to true for `free`.

import { NextResponse } from "next/server";

export const FREE_TIER_REMOVED_MESSAGE =
  "The free tier has been discontinued. Subscribe to a paid plan at /dashboard/billing to keep using Aether Router.";

export function isFreeTierBlocked(keyInfo: {
  planId: string;
  isCustom: boolean;
}): boolean {
  return !keyInfo.isCustom && keyInfo.planId === "free";
}

export function freeTierBlockedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        message: FREE_TIER_REMOVED_MESSAGE,
        type: "free_tier_discontinued",
      },
    },
    { status: 402 }
  );
}
