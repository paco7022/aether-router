import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

// Manually claim any gifts addressed to the signed-in user's email. Normally
// the AFTER INSERT trigger on profiles auto-claims on signup, but this covers
// gifts that arrived after the account existed, or a missed trigger. Idempotent
// (claim_gift only acts on paid_pending gifts).
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
  const { data: claimed, error } = await admin.rpc("claim_pending_gifts_for_user", {
    p_user_id: user.id,
  });

  if (error) {
    console.error("claim_pending_gifts_for_user failed:", error.message);
    return NextResponse.json({ error: "Failed to claim gifts" }, { status: 500 });
  }

  return NextResponse.json({ claimed: Number(claimed ?? 0) });
}
