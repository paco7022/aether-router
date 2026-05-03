import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

const BOOST_OPTIONS = {
  hour:      { credits: 2_500,   label: "1-hour context boost",            expiresIn: 60 * 60 * 1000 },
  permanent: { credits: 150_000, label: "Permanent context boost (plan)",   expiresIn: null },
} as const;

type BoostType = keyof typeof BOOST_OPTIONS;

// POST /api/v1/boost/context
// Body: { type: "hour" | "permanent" }
// Deducts credits and sets context_boost_expires_at on the user's profile.
export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const userSb = await createServerSupabase();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const boostType = body.type as BoostType;
  if (!boostType || !BOOST_OPTIONS[boostType]) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${Object.keys(BOOST_OPTIONS).join(", ")}` },
      { status: 400 }
    );
  }

  const option = BOOST_OPTIONS[boostType];
  const admin = createAdminClient();

  // Deduct credits atomically — returns -1 if insufficient.
  const { data: newBalance, error: deductErr } = await admin.rpc("deduct_credits", {
    p_user_id: user.id,
    p_amount: option.credits,
  });

  if (deductErr) {
    return NextResponse.json({ error: "Failed to process payment" }, { status: 500 });
  }
  if (newBalance === -1) {
    const { data: profile } = await admin
      .from("profiles")
      .select("credits, daily_credits")
      .eq("id", user.id)
      .single();
    const available = (profile?.credits ?? 0) + (profile?.daily_credits ?? 0);
    return NextResponse.json(
      { error: `Insufficient credits. Need ${option.credits}, have ${available}.`, credits_required: option.credits, credits_available: available },
      { status: 402 }
    );
  }

  // Set the boost expiry.
  const expiresAt = option.expiresIn === null
    ? "infinity"
    : new Date(Date.now() + option.expiresIn).toISOString();

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ context_boost_expires_at: expiresAt })
    .eq("id", user.id);

  if (updateErr) {
    // Refund credits on failure.
    await admin.rpc("add_credits", { p_user_id: user.id, p_amount: option.credits });
    return NextResponse.json({ error: "Failed to activate boost" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    boost_type: boostType,
    expires_at: expiresAt,
    credits_charged: option.credits,
    balance_after: newBalance,
  });
}
