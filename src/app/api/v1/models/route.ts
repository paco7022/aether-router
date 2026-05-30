import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// The active model list changes rarely (admin toggles), but /v1/models is
// polled on every dashboard load and by API clients. Cache the built payload
// in-process with a short TTL so we stop seq-scanning the models table on
// every request, and let the edge/CDN cache the response for a minute too.
const CACHE_TTL_MS = 60_000;
let cache: { body: unknown; expires: number } | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.body, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  }

  const supabase = createAdminClient();

  const { data: models, error } = await supabase
    .from("models")
    .select("id, capabilities")
    .eq("is_active", true)
    .order("id");

  if (error) {
    return NextResponse.json(
      { error: { message: "Failed to fetch models", type: "server_error" } },
      { status: 500 }
    );
  }

  // OpenAI-compatible /v1/models response format, extended with capabilities
  const data = (models || []).map((m) => ({
    id: m.id,
    object: "model",
    created: 0,
    owned_by: "aether-router",
    capabilities: m.capabilities ?? ["streaming", "system_message"],
  }));

  const body = { object: "list", data };
  cache = { body, expires: Date.now() + CACHE_TTL_MS };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
