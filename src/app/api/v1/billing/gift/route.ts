import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { requireCsrf } from "@/lib/csrf";
import { publicUrl } from "@/lib/public-endpoints";

// Basic, permissive email shape check. Real validation is that the recipient
// eventually owns this address (they must sign in with it to claim).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let body: {
    gift_type?: unknown;
    package_id?: unknown;
    plan_id?: unknown;
    months?: unknown;
    recipient_email?: unknown;
    message?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const giftType = body.gift_type;
  if (giftType !== "credits" && giftType !== "plan") {
    return NextResponse.json({ error: "Invalid gift_type" }, { status: 400 });
  }

  const recipientEmailRaw =
    typeof body.recipient_email === "string" ? body.recipient_email.trim().toLowerCase() : "";
  if (!recipientEmailRaw || recipientEmailRaw.length > 254 || !EMAIL_RE.test(recipientEmailRaw)) {
    return NextResponse.json({ error: "Invalid recipient email" }, { status: 400 });
  }

  const message =
    typeof body.message === "string" ? body.message.slice(0, 280) : undefined;

  const admin = createAdminClient();

  // Get or create the buyer's Stripe customer.
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

  // Common metadata: the webhook keys idempotency on the Stripe event id and
  // routes gifts through process_gift(). `purchase_type: "gift"` marks it.
  const baseMeta: Record<string, string> = {
    purchase_type: "gift",
    gift_type: giftType,
    sender_user_id: user.id,
    recipient_email: recipientEmailRaw,
  };
  if (message) baseMeta.gift_message = message;

  let productName: string;
  let productDescription: string;
  let unitAmountCents: number;

  if (giftType === "credits") {
    const packageId = body.package_id;
    if (typeof packageId !== "string" || !packageId || packageId.length > 64) {
      return NextResponse.json({ error: "Invalid package_id" }, { status: 400 });
    }
    const { data: pkg } = await admin
      .from("credit_packages")
      .select("*")
      .eq("id", packageId)
      .eq("is_active", true)
      .single();
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    productName = `Gift: ${pkg.name}`;
    productDescription = `${pkg.credits.toLocaleString()} permanent credits for ${recipientEmailRaw}`;
    unitAmountCents = Math.round(Number(pkg.price_usd) * 100);
    baseMeta.package_id = pkg.id;
    baseMeta.credits = String(pkg.credits);
  } else {
    // Plan gift: one-time payment for N months of a tier (auto-expires).
    const planId = body.plan_id;
    if (typeof planId !== "string" || !planId || planId.length > 64 || planId === "free") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    const months =
      Number.isInteger(body.months) && Number(body.months) >= 1 && Number(body.months) <= 12
        ? Number(body.months)
        : 1;

    const { data: plan } = await admin
      .from("plans")
      .select("*")
      .eq("id", planId)
      .eq("is_active", true)
      .single();
    if (!plan || Number(plan.price_usd) <= 0) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const planDays = months * 30;
    productName = `Gift: Aether ${plan.name} Plan`;
    productDescription = `${months} month${months > 1 ? "s" : ""} of ${plan.name} for ${recipientEmailRaw}`;
    unitAmountCents = Math.round(Number(plan.price_usd) * 100) * months;
    baseMeta.plan_id = plan.id;
    baseMeta.plan_days = String(planDays);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: productName, description: productDescription },
          unit_amount: unitAmountCents,
        },
        quantity: 1,
      },
    ],
    metadata: baseMeta,
    success_url: publicUrl("/dashboard/billing?checkout=gift_success"),
    cancel_url: publicUrl("/dashboard/billing?checkout=cancel"),
  });

  return NextResponse.json({ url: session.url });
}
