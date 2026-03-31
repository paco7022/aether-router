import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Disabled until Stripe is connected
  return NextResponse.json({ error: "Subscriptions are coming soon. Stripe integration pending." }, { status: 503 });

  const admin = createAdminClient();

  // Verify plan exists
  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .eq("is_active", true)
    .single();

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Cancel existing active subscription
  await admin
    .from("subscriptions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active");

  // Create new subscription
  const { error: subError } = await admin.from("subscriptions").insert({
    user_id: user.id,
    plan_id: plan.id,
    status: "active",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (subError) {
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
  }

  // Update profile plan
  await admin
    .from("profiles")
    .update({ plan_id: plan.id, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  // Grant first day's credits immediately
  if (plan.credits_per_day > 0) {
    await admin.rpc("add_credits", {
      p_user_id: user.id,
      p_amount: plan.credits_per_day,
    });

    // Get updated balance for transaction log
    const { data: profile } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    await admin.from("transactions").insert({
      user_id: user.id,
      amount: plan.credits_per_day,
      balance: profile?.credits || 0,
      type: "daily_grant",
      description: `Subscribed to ${plan.name} plan`,
    });
  }

  return NextResponse.json({ success: true, plan: plan.name });
}
