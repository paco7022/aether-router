import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get user's active subscription
  const { data: sub } = await admin
    .from("subscriptions")
    .select("id, plan_id, last_grant_date, plans(credits_per_day)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!sub) {
    return NextResponse.json({ error: "No active subscription" }, { status: 400 });
  }

  const plan = sub.plans as unknown as { credits_per_day: number };
  if (!plan?.credits_per_day || plan.credits_per_day <= 0) {
    return NextResponse.json({ error: "Your plan has no daily credits" }, { status: 400 });
  }

  // Check if already claimed today
  const today = new Date().toISOString().split("T")[0];
  if (sub.last_grant_date === today) {
    return NextResponse.json({ error: "Already claimed today", claimed: true }, { status: 400 });
  }

  // Grant daily credits (reset, not accumulate)
  await admin
    .from("profiles")
    .update({ daily_credits: plan.credits_per_day, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  // Get updated balance
  const { data: profile } = await admin
    .from("profiles")
    .select("credits, daily_credits")
    .eq("id", user.id)
    .single();

  // Log transaction
  await admin.from("transactions").insert({
    user_id: user.id,
    amount: plan.credits_per_day,
    balance: (profile?.daily_credits || 0) + (profile?.credits || 0),
    type: "daily_grant",
    description: "Daily plan credits (expire at end of day)",
  });

  // Mark as claimed
  await admin
    .from("subscriptions")
    .update({
      last_grant_date: today,
      credits_granted_today: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  return NextResponse.json({
    success: true,
    daily_credits: plan.credits_per_day,
    total: (profile?.daily_credits || 0) + (profile?.credits || 0),
  });
}
