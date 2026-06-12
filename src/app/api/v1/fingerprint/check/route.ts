import { NextRequest, NextResponse } from "next/server";
import { evaluateBanStatus } from "@/lib/ban";

// POST /api/v1/fingerprint/check — public, no auth required
// Used before registration to block banned devices
export async function POST(req: NextRequest) {
  const { fingerprint } = await req.json();
  if (!fingerprint || typeof fingerprint !== "string") {
    return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
  }

  // No userId yet (pre-registration): check the supplied fingerprint + client IP.
  const decision = await evaluateBanStatus({ headers: req.headers, fingerprint });
  if (decision?.blocked) {
    return NextResponse.json({ banned: true, reason: decision.reason });
  }

  return NextResponse.json({ banned: false });
}
