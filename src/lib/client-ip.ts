/**
 * Safe client IP extraction.
 *
 * `x-forwarded-for` is a comma-separated list. On a trusted reverse proxy the
 * rightmost entry is the IP the edge actually saw; entries to the left may have
 * been injected upstream or by the client. Blindly trusting the first entry lets
 * a client spoof their IP with `X-Forwarded-For: 1.2.3.4`.
 *
 * Preferred order:
 *   1. Cloudflare edge headers: `cf-connecting-ip`, then `true-client-ip`.
 *   2. Legacy Vercel header while old traffic drains.
 *   3. Rightmost non-empty `x-forwarded-for` entry.
 *   4. `x-real-ip`.
 *   5. "unknown".
 */

const UNKNOWN_IP = "unknown";
const TRUST_PROXY = process.env.TRUST_PROXY !== "false";

export function getClientIp(headers: Headers): string {
  if (!TRUST_PROXY) {
    return UNKNOWN_IP;
  }

  const cloudflare = headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  const trueClient = headers.get("true-client-ip")?.trim();
  if (trueClient) return trueClient;

  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const v = vercel.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (v) return v;
  }

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const entries = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;

  return UNKNOWN_IP;
}
