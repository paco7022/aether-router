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

  const { package_id } = await req.json();
  if (!package_id || typeof package_id !== "string" || package_id.length > 64) {
    return NextResponse.json({ error: "Invalid package_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Get the credit package
  const { data: pkg } = await admin
    .from("credit_packages")
    .select("*")
    .eq("id", package_id)
    .eq("is_active", true)
    .single();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
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

  // Create Stripe Checkout session for one-time payment
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: pkg.name,
            description: `${pkg.credits.toLocaleString()} permanent credits — never expire`,
          },
          unit_amount: Math.round(Number(pkg.price_usd) * 100), // cents
        },
        quantity: 1,
      },
    ],
    metadata: {
      supabase_user_id: user.id,
      package_id: pkg.id,
      credits: String(pkg.credits),
    },
    success_url: `${req.nextUrl.origin}/dashboard/billing?checkout=success`,
    cancel_url: `${req.nextUrl.origin}/dashboard/billing?checkout=cancel`,
  });

  return NextResponse.json({ url: session.url });
}
