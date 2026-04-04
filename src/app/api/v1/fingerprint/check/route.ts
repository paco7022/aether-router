import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/v1/fingerprint/check — public, no auth required
// Used before registration to block banned devices
export async function POST(req: NextRequest) {
  const { fingerprint } = await req.json();
  if (!fingerprint || typeof fingerprint !== "string") {
    return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: banned } = await admin
    .from("banned_fingerprints")
    .select("id, reason")
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (banned) {
    return NextResponse.json({ banned: true, reason: banned.reason || "Device banned" });
  }

  // Also check how many accounts this fingerprint is linked to
  const { count } = await admin
    .from("device_fingerprints")
    .select("*", { count: "exact", head: true })
    .eq("fingerprint", fingerprint);

  return NextResponse.json({ banned: false, linked_accounts: count || 0 });
}
