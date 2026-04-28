import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { requireCsrf } from "@/lib/csrf";

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

  const { plan_id } = await req.json();
  if (!plan_id || typeof plan_id !== "string" || plan_id.length > 64 || plan_id === "free") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Get the plan
  const { data: plan } = await admin
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .eq("is_active", true)
    .single();

  if (!plan || plan.price_usd <= 0) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Get or create Stripe customer
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email || profile?.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  // Check if user already has an active paid subscription
  const { data: existingSub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .not("stripe_subscription_id", "is", null)
    .single();

  // If they have an existing Stripe subscription, create a portal session to manage it
  if (existingSub?.stripe_subscription_id) {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${req.nextUrl.origin}/dashboard/billing`,
    });
    return NextResponse.json({ url: portalSession.url });
  }

  // Create Stripe Checkout session for new subscription
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Aether ${plan.name} Plan`,
            description: `${plan.credits_per_day.toLocaleString()} credits/day, ~${(plan.credits_per_month / 1000).toFixed(0)}K/month`,
          },
          unit_amount: Math.round(Number(plan.price_usd) * 100), // cents
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    metadata: {
      supabase_user_id: user.id,
      plan_id: plan.id,
    },
    subscription_data: {
      metadata: {
        supabase_user_id: user.id,
        plan_id: plan.id,
      },
    },
    success_url: `${req.nextUrl.origin}/dashboard/billing?checkout=success`,
    cancel_url: `${req.nextUrl.origin}/dashboard/billing?checkout=cancel`,
  });

  return NextResponse.json({ url: session.url });
}
