import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { getClientIp } from "@/lib/client-ip";

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

  const { code, fingerprint } = await req.json();
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  // Use trusted client IP — never the raw `x-forwarded-for` first token,
  // which is attacker-controlled and would let a Sybil farm bypass the
  // per-IP global dedupe by rotating the header.
  const ip = getClientIp(req.headers);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("redeem_referral", {
    p_referee_id: user.id,
    p_code: code,
    p_fingerprint: typeof fingerprint === "string" ? fingerprint : null,
    p_ip: ip,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to redeem" }, { status: 500 });
  }

  const result = data as {
    success?: boolean;
    error?: string;
    bonus_requests?: number;
    expires_at?: string;
  };

  if (!result?.success) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
