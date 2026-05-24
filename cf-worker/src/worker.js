// Aether Router edge traffic director.
//
// Day mode: route dynamic traffic to the home PC first, then fall back to the
// cloud origin. Night mode: route straight to the cloud origin.
//
// Required/optional env vars:
//   PC_ORIGIN=https://router.aether-ai.dev
//   CLOUD_ORIGIN=https://router-cloud.aether-ai.dev
//   PC_ACTIVE_START_HOUR=7
//   PC_ACTIVE_END_HOUR=22
//   ROUTING_TIMEZONE_OFFSET_MINUTES=-360

const DEFAULT_PC_ORIGIN = "https://router.aether-ai.dev";
const DEFAULT_CLOUD_ORIGIN = "https://router-cloud.aether-ai.dev";
const DEFAULT_PC_ACTIVE_START_HOUR = 7;
const DEFAULT_PC_ACTIVE_END_HOUR = 22;
const DEFAULT_TIMEZONE_OFFSET_MINUTES = -360;

const PC_TIMEOUT_MS = 25000;
const ALWAYS_CLOUD_PATHS = ["/api/v1/webhooks/stripe"];
const RATE_LIMITED_PATHS = new Set([
  "/api/v1/fingerprint/check",
  "/api/v1/models",
]);
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_HITS = 30;
const ipHits = new Map();

function cleanOrigin(value, fallback) {
  return String(value || fallback || "").trim().replace(/\/+$/, "");
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getConfig(env) {
  return {
    pcOrigin: cleanOrigin(env.PC_ORIGIN, DEFAULT_PC_ORIGIN),
    cloudOrigin: cleanOrigin(env.CLOUD_ORIGIN, DEFAULT_CLOUD_ORIGIN),
    allowedOrigins: String(
      env.ALLOWED_ORIGINS ||
        "https://router-cloud.aether-ai.dev,https://router.aether-ai.dev",
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    pcStartHour: readNumber(env.PC_ACTIVE_START_HOUR, DEFAULT_PC_ACTIVE_START_HOUR),
    pcEndHour: readNumber(env.PC_ACTIVE_END_HOUR, DEFAULT_PC_ACTIVE_END_HOUR),
    timezoneOffsetMinutes: readNumber(
      env.ROUTING_TIMEZONE_OFFSET_MINUTES,
      DEFAULT_TIMEZONE_OFFSET_MINUTES,
    ),
  };
}

function normalizeAppPath(pathname) {
  if (pathname === "/v1") return "/api/v1";
  if (pathname.startsWith("/v1/")) return `/api${pathname}`;
  return pathname;
}

function rewriteUrl(originalUrl, origin) {
  const u = new URL(originalUrl);
  const target = new URL(origin);
  target.pathname = normalizeAppPath(u.pathname);
  target.search = u.search;
  return target.toString();
}

function localHour(date, offsetMinutes) {
  const localMs = date.getTime() + offsetMinutes * 60 * 1000;
  return new Date(localMs).getUTCHours();
}

function isPcWindow(date, config) {
  const start = Math.max(0, Math.min(23, Math.floor(config.pcStartHour)));
  const end = Math.max(0, Math.min(23, Math.floor(config.pcEndHour)));
  const hour = localHour(date, config.timezoneOffsetMinutes);

  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function shouldGoStraightToCloud(pathname) {
  const normalizedPathname = normalizeAppPath(pathname);
  return ALWAYS_CLOUD_PATHS.some((p) => normalizedPathname === p || normalizedPathname.startsWith(p + "/"));
}

function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("true-client-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_HITS;
}

function pruneIpHits() {
  if (ipHits.size < 50_000) return;
  const now = Date.now();
  for (const [key, value] of ipHits) {
    if (value.resetAt < now) ipHits.delete(key);
  }
}

function getCorsHeaders(request, config) {
  const origin = request.headers.get("origin") || "";
  const pathname = normalizeAppPath(new URL(request.url).pathname);
  const auth = request.headers.get("authorization") || "";
  const hasBearer = auth.toLowerCase().startsWith("bearer ");
  const preflightAuthRequested = (
    request.headers.get("access-control-request-headers") || ""
  )
    .toLowerCase()
    .includes("authorization");

  const isModelsRoute = pathname === "/api/v1/models";
  const isBearerRoute =
    pathname === "/api/v1/chat/completions" &&
    (hasBearer || preflightAuthRequested);

  if (origin && config.allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE, PATCH",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-api-key, X-Requested-With, X-Device-Fingerprint",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
  }

  if (isBearerRoute || isModelsRoute) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-api-key, X-Device-Fingerprint",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
  }

  return { Vary: "Origin" };
}

async function forward(request, origin, signal, markProxied) {
  const url = rewriteUrl(request.url, origin);
  const headers = new Headers(request.headers);
  headers.delete("host");

  if (markProxied) {
    headers.set("x-aether-proxied", "1");
  }

  return fetch(url, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    signal,
  });
}

async function tryPc(request, config) {
  const ctrl = new AbortController();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("pc-timeout-headers")), PC_TIMEOUT_MS),
  );

  try {
    const res = await Promise.race([
      forward(request, config.pcOrigin, ctrl.signal, false),
      timeout,
    ]);

    if (res.status >= 500 && res.status !== 503) {
      return { ok: false, reason: `pc-${res.status}` };
    }

    return { ok: true, res };
  } catch (e) {
    try {
      ctrl.abort();
    } catch {}
    return { ok: false, reason: e.message || "pc-error" };
  }
}

function tagResponse(res, tags) {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(tags)) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const config = getConfig(env);
    const normalizedPathname = normalizeAppPath(url.pathname);

    if (RATE_LIMITED_PATHS.has(normalizedPathname)) {
      pruneIpHits();
      if (isRateLimited(getClientIp(request))) {
        return new Response(
          JSON.stringify({ error: { message: "Too many requests", type: "rate_limit" } }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "60",
              ...getCorsHeaders(request, config),
            },
          },
        );
      }
    }

    if (normalizedPathname.startsWith("/api/v1/") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, config),
      });
    }

    if (shouldGoStraightToCloud(url.pathname)) {
      const res = await forward(request, config.cloudOrigin, undefined, true);
      return tagResponse(res, {
        "x-aether-origin": "cloud",
        "x-aether-routing-mode": "cloud-pinned",
        "x-aether-routing-rule": "webhook-pinned",
        ...getCorsHeaders(request, config),
      });
    }

    if (isPcWindow(new Date(), config)) {
      const pcAttempt = await tryPc(request.clone(), config);
      if (pcAttempt.ok) {
        return tagResponse(pcAttempt.res, {
          "x-aether-origin": "pc",
          "x-aether-routing-mode": "day-pc-first",
          ...getCorsHeaders(request, config),
        });
      }

      const cloudRes = await forward(request, config.cloudOrigin, undefined, true);
      return tagResponse(cloudRes, {
        "x-aether-origin": "cloud",
        "x-aether-routing-mode": "day-pc-fallback",
        "x-aether-fallback-reason": pcAttempt.reason || "unknown",
        ...getCorsHeaders(request, config),
      });
    }

    const cloudRes = await forward(request, config.cloudOrigin, undefined, true);
    return tagResponse(cloudRes, {
      "x-aether-origin": "cloud",
      "x-aether-routing-mode": "night-cloud",
      ...getCorsHeaders(request, config),
    });
  },
};
