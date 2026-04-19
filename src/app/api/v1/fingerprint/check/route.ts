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
      // Do NOT leak the admin-written `reason` or the `source` discriminator
      // here — this endpoint is unauthenticated and would otherwise serve as
      // an enumeration oracle for moderator notes / banned-fingerprint sets.
      return NextResponse.json({ banned: true });
    }

    return NextResponse.json(
      { error: "Ban check unavailable" },
      { status: 503 }
    );
  }

  return NextResponse.json({ banned: false });
}
