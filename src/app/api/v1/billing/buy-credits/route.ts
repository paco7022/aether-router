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

  const { package_id } = await req.json();
  if (!package_id) {
    return NextResponse.json({ error: "package_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify package exists
  const { data: pkg } = await admin
    .from("credit_packages")
    .select("*")
    .eq("id", package_id)
    .eq("is_active", true)
    .single();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  // TODO: Integrate Stripe payment here
  // For now, directly grant credits (admin/test mode)

  // Add credits
  const { data: newBalance } = await admin.rpc("add_credits", {
    p_user_id: user.id,
    p_amount: pkg.credits,
  });

  // Log transaction
  await admin.from("transactions").insert({
    user_id: user.id,
    amount: pkg.credits,
    balance: newBalance ?? 0,
    type: "purchase",
    description: `Purchased ${pkg.name} ($${pkg.price_usd})`,
  });

  return NextResponse.json({
    success: true,
    credits_added: pkg.credits,
    new_balance: newBalance,
  });
}
