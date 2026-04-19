import { NextRequest, NextResponse } from "next/server";
import { evaluateBanStatus } from "@/lib/ban";

// POST /api/v1/fingerprint/check — public, no auth required
// Used before registration to block banned devices
export async function POST(req: NextRequest) {
  const { fingerprint } = await req.json();
  if (!fingerprint || typeof fingerprint !== "string") {
    return NextResponse.json({ error: "fingerprint required" }, { status: 400 });
  }

  const decision = await evaluateBanStatus({
    headers: req.headers,
    fingerprint: fingerprint.trim(),
  });

  if (decision?.blocked) {
    if (decision.statusCode === 403) {
      return NextResponse.json({ banned: true, reason: decision.reason, source: decision.source });
    }

    return NextResponse.json(
      { error: "Ban check unavailable", reason: decision.reason },
      { status: 503 }
    );
  }

  // Don't expose account count — it leaks information about other users.
  return NextResponse.json({ banned: false });
}
