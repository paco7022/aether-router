import { createAdminClient } from "./supabase/admin";

export interface ApiKeyInfo {
  keyId: string;
  userId: string;
  credits: number;
  dailyCredits: number;
  planId: string;
  gmClaimedDate: string | null;
  gmDailyOverride: number | null;
  gmOverrideExpires: string | null;
  // Per-key overrides (custom/event keys)
  isCustom: boolean;
  customCredits: number | null;
  maxContext: number | null;
  allowedProviders: string[] | null;
  dailyRequestLimit: number | null;
  rateLimitSeconds: number | null;
  expiresAt: string | null;
}

export async function validateApiKey(key: string): Promise<ApiKeyInfo | null> {
  const supabase = createAdminClient();

  // Hash the key with SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Look up key and join with profile for credits
  const { data: result, error } = await supabase
    .from("api_keys")
    .select("id, user_id, is_active, is_custom, custom_credits, max_context, allowed_providers, daily_request_limit, rate_limit_seconds, expires_at, last_used, profiles(credits, daily_credits, plan_id, gm_claimed_date, gm_daily_override, gm_override_expires)")
    .eq("key_hash", keyHash)
    .single();

  if (error || !result || !result.is_active) {
    return null;
  }

  // Check expiration for custom keys
  if (result.expires_at && new Date(result.expires_at) < new Date()) {
    return null;
  }

  // Debounce last_used update — only write if >5 minutes stale.
  // Avoids a DB write on every single API request under heavy load.
  const lastUsedMs = result.last_used ? new Date(result.last_used).getTime() : 0;
  if (Date.now() - lastUsedMs > 5 * 60_000) {
    // Fire-and-forget — non-critical update
    supabase
      .from("api_keys")
      .update({ last_used: new Date().toISOString() })
      .eq("id", result.id)
      .then(({ error: updateErr }) => {
        if (updateErr) console.error("Failed to update last_used:", updateErr.message);
      });
  }

  const profile = result.profiles as unknown as { credits: number; daily_credits: number; plan_id: string; gm_claimed_date: string | null; gm_daily_override: number | null; gm_override_expires: string | null };

  return {
    keyId: result.id,
    userId: result.user_id,
    credits: profile?.credits ?? 0,
    dailyCredits: profile?.daily_credits ?? 0,
    planId: profile?.plan_id ?? "free",
    gmClaimedDate: profile?.gm_claimed_date ?? null,
    gmDailyOverride: profile?.gm_daily_override ?? null,
    gmOverrideExpires: profile?.gm_override_expires ?? null,
    isCustom: result.is_custom ?? false,
    customCredits: result.custom_credits ?? null,
    maxContext: result.max_context ?? null,
    allowedProviders: result.allowed_providers ?? null,
    dailyRequestLimit: result.daily_request_limit ?? null,
    rateLimitSeconds: result.rate_limit_seconds ?? null,
    expiresAt: result.expires_at ?? null,
  };
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
