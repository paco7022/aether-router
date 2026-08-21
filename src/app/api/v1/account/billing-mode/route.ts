import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

// POST /api/v1/account/billing-mode — flip the account between the two ways
// premium models can be paid for.
//
//   "request" (default) — flat 1 credit + a premium-pool draw per call, under
//       the plan's context cap.
//   "payg"              — billed per token against credits, no pool draw and no
//       context cap, but more expensive per call. It is also the ONLY mode for
//       accounts without a plan (access bought with credits, profiles.is_paid).
//
// Per account, not per key: the router reads profiles.billing_mode on every
// request (see validateApiKey / validateSession). Only premium providers honour
// it — na/ and ds/ are genuine per-token upstreams and always bill at their own
// real cost, and free pools/promos stay free in either mode.
const VALID_MODES = ["request", "payg"] as const;
type BillingMode = (typeof VALID_MODES)[number];

function isBillingMode(value: unknown): value is BillingMode {
  return typeof value === "string" && (VALID_MODES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = (body as { mode?: unknown })?.mode;
  if (!isBillingMode(mode)) {
    return NextResponse.json(
      { error: `Invalid mode. Expected one of: ${VALID_MODES.join(", ")}.` },
      { status: 400 }
    );
  }

  // Admin client: profiles is not writable by the user's own session.
  const admin = createAdminClient();

  // Pay-as-you-go accounts (no plan, access bought with credits) cannot leave
  // 'payg': per-request billing draws a daily premium pool that the free row
  // does not have, so the switch would silently brick their access.
  if (mode === "request") {
    const { data: profile } = await admin
      .from("profiles")
      .select("plan_id")
      .eq("id", user.id)
      .single();
    if ((profile?.plan_id ?? "free") === "free") {
      return NextResponse.json(
        {
          error:
            "Pay-as-you-go is the only billing mode without a plan. Subscribe to switch to per-request billing.",
        },
        { status: 400 }
      );
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ billing_mode: mode })
    .eq("id", user.id);

  if (error) {
    console.error("Failed to update billing_mode:", error.message);
    return NextResponse.json({ error: "Failed to update billing mode" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, billing_mode: mode });
}
