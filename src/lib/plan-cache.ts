import type { SupabaseClient } from "@supabase/supabase-js";
import { TtlCache } from "./db-cache";

/**
 * Cached read of the plan-limit columns the completions hot path needs.
 * The plans table only changes when an admin edits a tier, so a 2-minute
 * TTL is invisible to users while removing up to three plans reads per
 * request (premium gate, free-provider context cap, zero-cost context cap).
 *
 * Failure semantics are preserved: errors and missing rows are NEVER
 * cached, so the premium gate's fail-closed 503 (see the [premium-gate]
 * comment in the completions route) still fires on every affected request
 * instead of being masked for a TTL window.
 */
export type PlanLimits = {
  gm_daily_requests: number | null;
  gm_max_context: number | null;
  allowed_providers: string[] | null;
  unlimited_providers: string[] | null;
};

const planCache = new TtlCache<PlanLimits>(120_000);

export async function getPlanLimits(
  supabase: SupabaseClient,
  planId: string
): Promise<{ data: PlanLimits | null; error: { message: string } | null }> {
  const cached = planCache.get(planId);
  if (cached) return { data: cached, error: null };

  const { data, error } = await supabase
    .from("plans")
    .select("gm_daily_requests, gm_max_context, allowed_providers, unlimited_providers")
    .eq("id", planId)
    .single();

  if (error || !data) {
    return { data: null, error: error ?? null };
  }

  planCache.set(planId, data as PlanLimits);
  return { data: data as PlanLimits, error: null };
}
