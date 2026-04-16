import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { requireCsrf } from "@/lib/csrf";

// DELETE /api/v1/account — permanently delete the authenticated user's account
export async function DELETE(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Cancel any active Stripe subscriptions before deleting the user
  const { data: activeSubs } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("stripe_subscription_id", "is", null);

  for (const sub of activeSubs || []) {
    if (sub.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } catch (stripeErr) {
        console.error(
          `Failed to cancel Stripe subscription ${sub.stripe_subscription_id} during account deletion:`,
          stripeErr
        );
      }
    }
  }

  // Remove device fingerprint links so the person can register again
  await admin.from("device_fingerprints").delete().eq("user_id", user.id);

  // Delete auth user — CASCADE removes profiles, api_keys, usage_logs, transactions, subscriptions
  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
