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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown";

  const [fpBan, ipBan] = await Promise.all([
    admin.from("banned_fingerprints").select("id, reason").eq("fingerprint", fingerprint).maybeSingle(),
    ip !== "unknown"
      ? admin.from("banned_fingerprints").select("id, reason").eq("ip_address", ip).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const banned = fpBan.data || ipBan.data;

  if (banned) {
    return NextResponse.json({ banned: true, reason: banned.reason || "Device banned" });
  }

  // Don't expose account count — it leaks information about other users.
  return NextResponse.json({ banned: false });
}
