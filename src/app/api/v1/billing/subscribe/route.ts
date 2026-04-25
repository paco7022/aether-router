import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { requireCsrf } from "@/lib/csrf";

// New plan subscriptions are disabled. Aether Router is migrating to a pure
// pay-as-you-go model. Existing subscriptions keep working until they end;
// users can still reach the Stripe billing portal to manage their current
// subscription, but no new checkouts are created.

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

  const admin = createAdminClient();

  // Existing subscribers can still reach the Stripe billing portal to
  // cancel/manage what they already have. Everyone else gets the
  // "no new subscriptions" message.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (profile?.stripe_customer_id) {
    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .not("stripe_subscription_id", "is", null)
      .single();

    if (existingSub?.stripe_subscription_id) {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${req.nextUrl.origin}/dashboard/billing`,
      });
      return NextResponse.json({ url: portalSession.url });
    }
  }

  return NextResponse.json(
    {
      error: {
        message:
          "New plan subscriptions are no longer available — Aether Router is moving to pay-as-you-go. Buy credits instead.",
        type: "subscriptions_disabled",
      },
    },
    { status: 410 }
  );
}
