import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { requireCsrf } from "@/lib/csrf";
import { publicUrl } from "@/lib/public-endpoints";
import { CREDITS_PER_USD } from "@/lib/constants";

// Enterprise self-service token top-up. The customer buys prepaid tokens for an
// existing flat_per_token custom key (provisioned by the operator). Price is
// dynamic: tokens × flat_cost_per_m_tokens (e.g. $3/M). The Stripe webhook
// credits the key's custom_credits via purchase_custom_key_credits.
const MIN_TOKENS = 100_000_000; // 100M minimum for it to be worthwhile.
const MAX_TOKENS = 20_000_000_000; // 20B cap — keeps custom_credits (int4) well in range.

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

  let body: { key_id?: unknown; tokens?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { key_id, tokens } = body;
  if (!key_id || typeof key_id !== "string") {
    return NextResponse.json({ error: "Invalid key_id" }, { status: 400 });
  }
  const tokenCount = Number(tokens);
  if (!Number.isFinite(tokenCount) || !Number.isInteger(tokenCount) || tokenCount < MIN_TOKENS || tokenCount > MAX_TOKENS) {
    return NextResponse.json(
      { error: `tokens must be an integer between ${MIN_TOKENS.toLocaleString()} and ${MAX_TOKENS.toLocaleString()}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // The key must exist, belong to this user, be a flat_per_token enterprise key.
  const { data: key } = await admin
    .from("api_keys")
    .select("id, user_id, is_custom, pricing_mode, flat_cost_per_m_tokens, is_active, name")
    .eq("id", key_id)
    .single();

  if (!key || key.user_id !== user.id || !key.is_custom || key.pricing_mode !== "flat_per_token") {
    return NextResponse.json({ error: "Enterprise key not found" }, { status: 404 });
  }
  const rate = Number(key.flat_cost_per_m_tokens);
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: "Key has no valid per-token rate" }, { status: 400 });
  }

  const usd = (tokenCount / 1_000_000) * rate;
  const credits = Math.round((tokenCount / 1_000_000) * rate * CREDITS_PER_USD);

  // Get or create Stripe customer.
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
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Enterprise tokens — ${key.name || "key"}`,
            description: `${tokenCount.toLocaleString()} prepaid tokens (or/) at $${rate}/M — never expire`,
          },
          unit_amount: Math.round(usd * 100), // cents
        },
        quantity: 1,
      },
    ],
    metadata: {
      supabase_user_id: user.id,
      key_id: key.id,
      tokens: String(tokenCount),
      credits: String(credits),
      purchase_type: "enterprise_tokens",
    },
    success_url: publicUrl("/dashboard/enterprise?checkout=success"),
    cancel_url: publicUrl("/dashboard/enterprise?checkout=cancel"),
  });

  return NextResponse.json({ url: session.url });
}
