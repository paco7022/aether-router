import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("plan_id")
    .eq("id", user.id)
    .single();

  if (profileError) {
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }

  if (profile?.plan_id === "free") {
    return NextResponse.json(
      { error: "Free accounts include premium requests only, not daily credits", claimed: false },
      { status: 400 }
    );
  }

  // Atomic claim: locks subscription row to prevent double-claim race conditions
  const { data, error } = await admin.rpc("claim_daily_credits", {
    p_user_id: user.id,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to claim credits" }, { status: 500 });
  }

  const result = data as { success?: boolean; error?: string; claimed?: boolean; daily_credits?: number; total?: number };

  if (result.error) {
    return NextResponse.json(
      { error: result.error, claimed: result.claimed ?? false },
      { status: 400 }
    );
  }

  return NextResponse.json(result);
}
