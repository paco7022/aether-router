// aether-router edge router
//
// Routing rules:
//   1. Stripe webhook -> ALWAYS Vercel (single source of truth for secret/handlers).
//   2. Everything else: try PC tunnel first; on timeout / network err / 5xx,
//      fall back to Vercel.
//
// Streaming: chat completions use SSE. We forward Response objects without
// reading the body, so streaming works end-to-end.

const PC_ORIGIN = "https://router.aether-ai.dev";
const VERCEL_ORIGIN = "https://aether-router.vercel.app";

// PC is healthy but upstream (Claude providers) can take 5-15s to first byte
// for non-streaming requests. Generous timeout so we only fall back when PC
// is actually unreachable or upstream is really stuck. A dead tunnel returns
// a 5xx immediately from Cloudflare, which also triggers fallback.
const PC_TIMEOUT_MS = 25000;

const ALWAYS_VERCEL_PATHS = [
  "/api/v1/webhooks/stripe",
];

function rewriteUrl(originalUrl, origin) {
  const u = new URL(originalUrl);
  const target = new URL(origin);
  target.pathname = u.pathname;
  target.search = u.search;
  return target.toString();
}

// markProxied: when true, stamp `x-aether-proxied: 1` so the destination
// (Vercel) does not itself re-proxy to the PC. Used on the Vercel fallback
// path — the Worker already decided the PC is unavailable.
async function forward(request, origin, signal, markProxied) {
  const url = rewriteUrl(request.url, origin);
  let headers = request.headers;
  if (markProxied) {
    headers = new Headers(request.headers);
    headers.set("x-aether-proxied", "1");
  }
  const init = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    signal,
  };
  return fetch(url, init);
}

function shouldGoStraightToVercel(pathname) {
  return ALWAYS_VERCEL_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

async function tryPc(request) {
  const ctrl = new AbortController();
  const headersStarted = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("pc-timeout-headers")), PC_TIMEOUT_MS),
  );
  const fetchPc = forward(request, PC_ORIGIN, ctrl.signal);
  try {
    const res = await Promise.race([fetchPc, headersStarted]);
    if (res.status >= 500 && res.status !== 503) {
      // Treat upstream 5xx as failure -> fallback
      // (but a 503 from upstream provider is a real signal; let PC return it)
      return { ok: false, reason: `pc-${res.status}`, ctrl };
    }
    return { ok: true, res };
  } catch (e) {
    try { ctrl.abort(); } catch {}
    return { ok: false, reason: e.message || "pc-error" };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Static rule: webhook always Vercel
    if (shouldGoStraightToVercel(url.pathname)) {
      const res = await forward(request, VERCEL_ORIGIN);
      const headers = new Headers(res.headers);
      headers.set("x-aether-origin", "vercel");
      headers.set("x-aether-routing-rule", "webhook-pinned");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    // Only forward API + auth + assets matter for proxying.
    // (Worker handles entire hostname, so dashboard pages also pass through.)

    // Try PC first
    const pcAttempt = await tryPc(request.clone());
    if (pcAttempt.ok) {
      // Tag the response so we know who served it (debug)
      const res = pcAttempt.res;
      const headers = new Headers(res.headers);
      headers.set("x-aether-origin", "pc");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    // Fallback to Vercel. Mark the request as already-proxied so Vercel's
    // own PC-failover does not re-attempt the PC we just found unavailable.
    const vercelRes = await forward(request, VERCEL_ORIGIN, undefined, true);
    const headers = new Headers(vercelRes.headers);
    headers.set("x-aether-origin", "vercel");
    headers.set("x-aether-fallback-reason", pcAttempt.reason || "unknown");
    return new Response(vercelRes.body, {
      status: vercelRes.status,
      statusText: vercelRes.statusText,
      headers,
    });
  },
};
