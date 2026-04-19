import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { evaluateBanStatus } from "@/lib/ban";

// [SECURITY] Allowed origins for CORS. Only these origins may make
// cross-origin requests. Configure via ALLOWED_ORIGINS env var
// (comma-separated) or fall back to the NEXT_PUBLIC_SITE_URL.
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || process.env.NEXT_PUBLIC_SITE_URL || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
);

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";

  // API-key authenticated endpoints (chat/completions, models) need broad
  // CORS since CLI tools and third-party apps call them. Session-based
  // endpoints (admin, billing, account, fingerprint) are restricted.
  const isApiKeyRoute =
    request.nextUrl.pathname === "/api/v1/chat/completions" ||
    request.nextUrl.pathname === "/api/v1/models";

  const allowedOrigin =
    ALLOWED_ORIGINS.has(origin) ? origin : isApiKeyRoute ? origin : "";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-api-key, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// IP-based rate limiter for unauthenticated endpoints (fingerprint/check, models).
// Simple sliding-window counter stored in-memory (resets on cold start, which is fine).
const ipHits = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_HITS = 30; // 30 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX_HITS;
}

// Endpoints that are public (no auth) and need rate limiting
const RATE_LIMITED_PATHS = new Set([
  "/api/v1/fingerprint/check",
  "/api/v1/models",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit unauthenticated endpoints
  if (RATE_LIMITED_PATHS.has(pathname)) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: { message: "Too many requests", type: "rate_limit" } },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  // CORS preflight for API routes
  if (pathname.startsWith("/api/v1/") && request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  // Don't protect API routes (they use API key auth), auth pages, or public assets
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname === "/" ||
    pathname.startsWith("/_next/")
  ) {
    // Add CORS headers to API responses
    if (pathname.startsWith("/api/v1/")) {
      const response = NextResponse.next();
      const corsHeaders = getCorsHeaders(request);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not logged in and trying to access dashboard, redirect to login
  if (!user && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/dashboard")) {
    const banDecision = await evaluateBanStatus({
      headers: request.headers,
      userId: user.id,
    });

    if (banDecision?.blocked) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "banned");
      url.searchParams.set("reason", banDecision.reason);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
