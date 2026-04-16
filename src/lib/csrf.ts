import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF protection for session-based (cookie-authenticated) endpoints.
 *
 * Requires the `X-Requested-With` header to be present. Browsers will
 * not include custom headers in cross-origin requests unless the server
 * explicitly allows them via CORS — and our CORS policy only allows
 * the header for our own origin. This blocks cross-site form posts
 * and fetch attacks from malicious pages.
 *
 * API-key authenticated endpoints (chat/completions, models) do NOT
 * need this because they don't rely on cookies.
 */
export function requireCsrf(req: NextRequest): NextResponse | null {
  const xrw = req.headers.get("x-requested-with");
  if (!xrw) {
    return NextResponse.json(
      { error: "Missing X-Requested-With header" },
      { status: 403 }
    );
  }
  return null;
}
