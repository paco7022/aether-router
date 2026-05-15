import type { NextRequest } from "next/server";

// Marker header. A request that already carries it must NOT be proxied again
// (prevents Vercel <-> PC <-> Worker loops).
const PROXY_HEADER = "x-aether-proxied";

// Time budget for the PC to return *response headers*. Claude upstreams can
// take 5-15s to first byte for non-streaming calls, so this is generous. A
// genuinely unreachable PC fails far faster than this (TCP refused / tunnel
// 5xx), so the timeout only bites when the PC is alive but wedged.
const PC_HEADERS_TIMEOUT_MS = 25_000;

/**
 * Attempt to serve the request from the home-PC origin.
 *
 * Returns the PC's `Response` on success, or `null` to tell the caller to
 * handle the request locally (the normal Vercel path).
 *
 * Enabled only when `PC_ORIGIN_URL` is set — Vercel sets it, the PC itself
 * leaves it unset so it never proxies to itself. The `x-aether-proxied`
 * header is the second line of defense against loops.
 *
 * The request body is taken from a clone, so when this returns `null` the
 * original `req` still has an unread body for the local handler.
 */
export async function tryPcFailover(req: NextRequest): Promise<Response | null> {
  const pcOrigin = process.env.PC_ORIGIN_URL;
  if (!pcOrigin) return null; // disabled, or this deployment IS the PC
  if (req.headers.get(PROXY_HEADER) === "1") return null; // loop breaker

  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, pcOrigin);

  const headers = new Headers(req.headers);
  headers.set(PROXY_HEADER, "1");
  headers.delete("host"); // let fetch derive it from the target
  headers.delete("content-length"); // re-derived from the streamed body

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PC_HEADERS_TIMEOUT_MS);

  try {
    // Clone so the original request body survives for the local handler
    // when we fall through.
    const pcReq = req.clone();
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: pcReq.body,
      // duplex is required to stream a request body; not in the TS lib yet.
      duplex: "half",
      redirect: "manual",
      signal: controller.signal,
    } as RequestInit);
    clearTimeout(timer);

    // 5xx (except 503, which a real upstream provider may legitimately
    // return) means the PC is unhealthy -> fall back to local.
    if (res.status >= 500 && res.status !== 503) return null;

    const outHeaders = new Headers(res.headers);
    outHeaders.set("x-aether-origin", "pc");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  } catch {
    clearTimeout(timer);
    return null; // network error / timeout / aborted -> fall back to local
  }
}
