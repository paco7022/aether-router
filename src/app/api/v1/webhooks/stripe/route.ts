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

  // Idempotency: process each Stripe event only once.
  const { error: lockError } = await admin
    .from("stripe_webhook_events")
    .insert({
      event_id: event.id,
      event_type: event.type,
      success: false,
    });

  if (lockError) {
    const maybeCode = (lockError as { code?: string }).code;
    if (maybeCode === "23505") {
      const { data: existing, error: existingErr } = await admin
        .from("stripe_webhook_events")
        .select("success")
        .eq("event_id", event.id)
        .maybeSingle();

      if (existingErr) {
        console.error("Failed to read existing webhook event:", existingErr);
        return NextResponse.json({ error: "Webhook idempotency check failed" }, { status: 500 });
      }

      if (existing?.success) {
        return NextResponse.json({ received: true, duplicate: true });
      }

      // Previous processing failed; allow retry and overwrite stale error state.
      const { error: retryLockErr } = await admin
        .from("stripe_webhook_events")
        .update({ event_type: event.type, error: null, processed_at: null })
        .eq("event_id", event.id);

      if (retryLockErr) {
        console.error("Failed to prepare failed webhook event for retry:", retryLockErr);
        return NextResponse.json({ error: "Webhook retry lock failed" }, { status: 500 });
      }
    } else {
      console.error("Failed to acquire webhook idempotency lock:", lockError);
      return NextResponse.json({ error: "Webhook lock failed" }, { status: 500 });
    }
  }

  try {
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

            // Paid-conversion referral bonus: if this user was referred,
            // grant +15 premium requests/day for 7 days to both sides.
            // Fires on every paid checkout (first sub or upgrade).
            const { error: refBonusErr } = await admin.rpc("grant_paid_referral_bonus", {
              p_referee_id: userId,
              p_bonus: 15,
              p_days: 7,
            });
            if (refBonusErr) {
              console.error("grant_paid_referral_bonus failed:", refBonusErr.message);
            }
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
          // Retrieve actual period from Stripe subscription items rather than
          // using a hardcoded 30-day window which drifts over time.
          let periodStart = new Date().toISOString();
          let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          try {
            const stripeSub = await stripe.subscriptions.retrieve(stripeSubId, {
              expand: ["items"],
            });
            const firstItem = stripeSub.items?.data?.[0];
            if (firstItem?.current_period_start) {
              periodStart = new Date(firstItem.current_period_start * 1000).toISOString();
            }
            if (firstItem?.current_period_end) {
              periodEnd = new Date(firstItem.current_period_end * 1000).toISOString();
            }
          } catch (stripeErr) {
            console.error("Failed to retrieve subscription period from Stripe:", stripeErr);
          }

          await admin
            .from("subscriptions")
            .update({
              current_period_start: periodStart,
              current_period_end: periodEnd,
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
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : "Unknown webhook processing error";
    await admin
      .from("stripe_webhook_events")
      .update({ success: false, error: message, processed_at: new Date().toISOString() })
      .eq("event_id", event.id);

    console.error("Webhook processing failed:", processingError);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  await admin
    .from("stripe_webhook_events")
    .update({ success: true, error: null, processed_at: new Date().toISOString() })
    .eq("event_id", event.id);

  return NextResponse.json({ received: true });
}
