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
  const { data, error } = await admin.rpc("claim_gm_requests", {
    p_user_id: user.id,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to claim" }, { status: 500 });
  }

  const result = data as { success?: boolean; error?: string; claimed?: boolean; requests?: number; reason?: string };

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, claimed: false },
      { status: 400 }
    );
  }

  return NextResponse.json(result);
}
