import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

// t/ half-price package: pay 50k credits, get trolllm (t/) premium requests at
// half cost (Opus 6→3, Sonnet 3→1.5) for 30 days. Stacks: buying again while
// active extends the expiry by another 30 days.
const T_DISCOUNT_CREDITS = 50_000;
const T_DISCOUNT_MS = 30 * 24 * 60 * 60 * 1000;

// POST /api/v1/billing/t-discount
export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const userSb = await createServerSupabase();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Deduct credits atomically — returns -1 if insufficient.
  const { data: newBalance, error: deductErr } = await admin.rpc("deduct_credits", {
    p_user_id: user.id,
    p_amount: T_DISCOUNT_CREDITS,
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
      {
        error: `Insufficient credits. Need ${T_DISCOUNT_CREDITS.toLocaleString()}, have ${available.toLocaleString()}.`,
        credits_required: T_DISCOUNT_CREDITS,
        credits_available: available,
      },
      { status: 402 }
    );
  }

  // Stack on any remaining time: extend from max(now, current expiry).
  const { data: current } = await admin
    .from("profiles")
    .select("t_discount_expires_at")
    .eq("id", user.id)
    .single();

  const now = Date.now();
  const existing = current?.t_discount_expires_at
    ? new Date(current.t_discount_expires_at).getTime()
    : 0;
  const base = existing > now ? existing : now;
  const expiresAt = new Date(base + T_DISCOUNT_MS).toISOString();

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ t_discount_expires_at: expiresAt })
    .eq("id", user.id);

  if (updateErr) {
    // Refund credits on failure so the user isn't charged for nothing.
    await admin.rpc("add_credits", { p_user_id: user.id, p_amount: T_DISCOUNT_CREDITS });
    return NextResponse.json({ error: "Failed to activate discount" }, { status: 500 });
  }

  // Record the spend in the ledger for transparency.
  await admin.from("transactions").insert({
    user_id: user.id,
    amount: -T_DISCOUNT_CREDITS,
    balance: newBalance,
    type: "t_discount",
    description: "t/ half-price package (30 days)",
  });

  return NextResponse.json({
    success: true,
    expires_at: expiresAt,
    credits_charged: T_DISCOUNT_CREDITS,
    balance_after: newBalance,
  });
}
