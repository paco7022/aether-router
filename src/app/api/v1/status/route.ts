import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyHealth, type ModelHealthRow, type HealthState } from "@/lib/model-health";

export const runtime = "nodejs";

// The status page is a 15-minute snapshot, not a live feed: the underlying
// rollup is an aggregate over usage_logs and the shared compute's Disk IO
// budget is the scarce resource (2026-06-08 outage). One in-process cache
// entry + the same s-maxage at the edge means a page refresh storm still
// costs at most one query per node per window.
const CACHE_TTL_MS = 15 * 60_000;
const WINDOW_MINUTES = 1440; // rows considered at all (24h)
const RECENT_MINUTES = 60; // preferred bucket for the verdict

type StatusModel = {
  id: string;
  display_name: string;
  provider: string;
  state: HealthState;
  last_ok: string | null;
  last_error: string | null;
  last_error_code: string | null;
};

let cache: { body: unknown; expires: number } | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.body, {
      headers: { "Cache-Control": "public, max-age=900, s-maxage=900" },
    });
  }

  const supabase = createAdminClient();

  const [{ data: models, error: modelsErr }, { data: health, error: healthErr }] = await Promise.all([
    supabase.from("models").select("id, display_name, provider").eq("is_active", true).order("id"),
    supabase.rpc("get_model_health", {
      p_window_minutes: WINDOW_MINUTES,
      p_recent_minutes: RECENT_MINUTES,
    }),
  ]);

  if (modelsErr || healthErr) {
    return NextResponse.json(
      { error: { message: "Failed to fetch status", type: "server_error" } },
      { status: 500 }
    );
  }

  const byModel = new Map<string, ModelHealthRow>();
  for (const row of (health ?? []) as ModelHealthRow[]) byModel.set(row.model_id, row);

  const data: StatusModel[] = (models ?? []).map((m) => {
    const row = byModel.get(m.id);
    const verdict = classifyHealth(row);
    return {
      id: m.id,
      display_name: m.display_name,
      provider: m.provider,
      state: verdict.state,
      last_ok: row?.last_ok ?? null,
      last_error: row?.last_err ?? null,
      last_error_code: row?.last_err_code ?? null,
    };
  });

  const summary = data.reduce<Record<HealthState, number>>(
    (acc, m) => ({ ...acc, [m.state]: acc[m.state] + 1 }),
    { operational: 0, degraded: 0, down: 0, idle: 0 }
  );

  const body = {
    generated_at: new Date().toISOString(),
    window_minutes: WINDOW_MINUTES,
    recent_minutes: RECENT_MINUTES,
    refresh_seconds: CACHE_TTL_MS / 1000,
    summary,
    models: data,
  };
  cache = { body, expires: Date.now() + CACHE_TTL_MS };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=900, s-maxage=900" },
  });
}
