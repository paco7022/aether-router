import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    // ── One-time credit purchase completed ──
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === "payment" && session.payment_status === "paid") {
        const userId = session.metadata?.supabase_user_id;
        const credits = Number(session.metadata?.credits);
        const packageId = session.metadata?.package_id;

        if (userId && credits > 0) {
          // Add permanent credits
          await admin.rpc("add_credits", {
            p_user_id: userId,
            p_amount: credits,
          });

          // Log transaction
          const { data: profile } = await admin
            .from("profiles")
            .select("credits")
            .eq("id", userId)
            .single();

          await admin.from("transactions").insert({
            user_id: userId,
            amount: credits,
            balance: profile?.credits || 0,
            type: "purchase",
            description: `Purchased ${packageId} (${credits.toLocaleString()} credits)`,
          });
        }
      }

      // For subscription checkouts, the subscription events below handle activation
      if (session.mode === "subscription") {
        const userId = session.metadata?.supabase_user_id;
        const planId = session.metadata?.plan_id;
        const stripeSubId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (userId && planId && stripeSubId) {
          // Deactivate any existing subscriptions
          await admin
            .from("subscriptions")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("status", "active");

          // Create new subscription record
          await admin.from("subscriptions").insert({
            user_id: userId,
            plan_id: planId,
            status: "active",
            stripe_subscription_id: stripeSubId,
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
          });

          // Update user's plan
          await admin
            .from("profiles")
            .update({ plan_id: planId })
            .eq("id", userId);

          // Don't auto-grant daily credits — user must click "Claim" button
          // This ensures users know they've received their daily allowance
        }
      }
      break;
    }

    // ── Subscription renewed (recurring payment succeeded) ──
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subRef = invoice.parent?.subscription_details?.subscription;
      const stripeSubId =
        typeof subRef === "string" ? subRef : subRef?.id;

      // Skip the first invoice (handled by checkout.session.completed)
      if (!stripeSubId || invoice.billing_reason === "subscription_create") {
        break;
      }

      // Find the subscription in our DB
      const { data: sub } = await admin
        .from("subscriptions")
        .select("*, plans(credits_per_day)")
        .eq("stripe_subscription_id", stripeSubId)
        .eq("status", "active")
        .single();

      if (sub) {
        // Update period
        await admin
          .from("subscriptions")
          .update({
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", sub.id);
      }
      break;
    }

    // ── Subscription cancelled or expired ──
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      // Deactivate in our DB
      const { data: sub } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_subscription_id", subscription.id)
        .single();

      if (sub) {
        await admin
          .from("subscriptions")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subscription.id);

        // Revert to free plan
        await admin
          .from("profiles")
          .update({ plan_id: "free" })
          .eq("id", sub.user_id);

        // Ensure they have a free subscription
        await admin.from("subscriptions").insert({
          user_id: sub.user_id,
          plan_id: "free",
          status: "active",
        });
      }
      break;
    }

    // ── Payment failed on renewal ──
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const failedSubRef = invoice.parent?.subscription_details?.subscription;
      const stripeSubId =
        typeof failedSubRef === "string" ? failedSubRef : failedSubRef?.id;

      if (stripeSubId) {
        await admin
          .from("subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", stripeSubId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
