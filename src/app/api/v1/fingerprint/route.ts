import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

// POST /api/v1/fingerprint — store fingerprint + check ban
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

  const { fingerprint } = await req.json();
  if (!fingerprint || typeof fingerprint !== "string") {
    return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Check if fingerprint is banned
  const { data: banned } = await admin
    .from("banned_fingerprints")
    .select("id, reason")
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (banned) {
    return NextResponse.json(
      { banned: true, reason: banned.reason || "Device banned" },
      { status: 403 }
    );
  }

  // Upsert device fingerprint
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown";
  const userAgent = req.headers.get("user-agent") || "unknown";

  await admin.from("device_fingerprints").upsert(
    {
      user_id: user.id,
      fingerprint,
      user_agent: userAgent,
      ip_address: ip,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,fingerprint" }
  );

  return NextResponse.json({ banned: false });
}
