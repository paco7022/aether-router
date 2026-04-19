/**
 * Safe client IP extraction.
 *
 * Problem: `x-forwarded-for` is a comma-separated list. On Vercel (and any
 * trusted reverse proxy) the **rightmost** entry is the IP the edge actually
 * saw; any entries to the left were injected by an upstream hop or — in the
 * worst case — directly by the client. Blindly trusting `.split(",")[0]` lets
 * a client spoof their IP by prepending `X-Forwarded-For: 1.2.3.4`.
 *
 * We prefer, in order:
 *   1. `x-vercel-forwarded-for` (Vercel's own, always trustworthy on Vercel)
 *   2. Rightmost non-empty entry of `x-forwarded-for`
 *   3. `x-real-ip`
 *   4. "unknown"
 *
 * On self-hosted deployments this assumes the request is proxied through a
 * hop that only appends. If you run without a proxy, set TRUST_PROXY=false
 * to ignore forwarded headers entirely.
 */

const UNKNOWN_IP = "unknown";
const TRUST_PROXY = process.env.TRUST_PROXY !== "false";

export function getClientIp(headers: Headers): string {
  if (!TRUST_PROXY) {
    return UNKNOWN_IP;
  }

  // Vercel sets this to the real client IP it observed at the edge. It is
  // NOT forwardable — clients cannot inject this header on Vercel.
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const v = vercel.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (v) return v;
  }

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // Rightmost = closest to our server = the IP our trusted proxy saw.
    const entries = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;

  return UNKNOWN_IP;
}
