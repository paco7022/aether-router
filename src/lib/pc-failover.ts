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
 * `rawBody` is the already-buffered request body (the caller reads `req.body`
 * exactly once and shares it both here and with local handling). We forward
 * it as a plain byte body — no request-body streaming, no `req.clone()`,
 * which keeps this robust across the Vercel Node runtime.
 */
export async function tryPcFailover(
  req: NextRequest,
  rawBody: Uint8Array,
): Promise<Response | null> {
  // Trim defensively: env values can pick up a trailing CR/LF depending on
  // how they were set (e.g. piped through a shell), and a stray \r makes
  // both `new URL()` and `fetch()` throw "Invalid URL".
  const pcOrigin = (process.env.PC_ORIGIN_URL || "").trim().replace(/\/+$/, "");
  if (!pcOrigin) return null; // disabled, or this deployment IS the PC
  if (req.headers.get(PROXY_HEADER) === "1") return null; // loop breaker

  // String concat (not `new URL`) so a malformed origin can't throw here —
  // a bad URL just makes the fetch below fail and we fall back to local.
  const target = pcOrigin + req.nextUrl.pathname + req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.set(PROXY_HEADER, "1");
  // Strip hop-by-hop / length headers — fetch re-derives them from rawBody.
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.delete("connection");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PC_HEADERS_TIMEOUT_MS);

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      // A Uint8Array is a valid fetch body at runtime; the cast only works
      // around the generic-Uint8Array vs BodyInit type mismatch in TS 6.
      body: rawBody as unknown as BodyInit,
      redirect: "manual",
      signal: controller.signal,
    });
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
