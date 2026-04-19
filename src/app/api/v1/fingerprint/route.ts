import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { evaluateBanStatus, getClientIpFromHeaders } from "@/lib/ban";

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
  const cleanFingerprint = fingerprint.trim();
  if (!cleanFingerprint) {
    return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
  }

  const banDecision = await evaluateBanStatus({
    headers: req.headers,
    userId: user.id,
    fingerprint: cleanFingerprint,
    adminClient: admin,
  });

  if (banDecision?.blocked) {
    if (banDecision.statusCode === 403) {
      return NextResponse.json(
        { banned: true, reason: banDecision.reason, source: banDecision.source },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Ban check unavailable", reason: banDecision.reason },
      { status: 503 }
    );
  }

  const ip = getClientIpFromHeaders(req.headers);
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { error: upsertErr } = await admin.from("device_fingerprints").upsert(
    {
      user_id: user.id,
      fingerprint: cleanFingerprint,
      user_agent: userAgent,
      ip_address: ip,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,fingerprint" }
  );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ banned: false });
}
