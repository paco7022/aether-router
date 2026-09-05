import { createAdminClient } from "./supabase/admin";
import { createServerSupabase } from "./supabase/server";
import type { UserPreset } from "./preset";
import type { Lorebook } from "./lorebook";

export interface ApiKeyInfo {
  // keyId is null when the caller authenticated with a Supabase session
  // (in-dashboard chat) instead of a real API key. usage_logs.api_key_id
  // is nullable to accommodate this; `source` distinguishes the two.
  keyId: string | null;
  userId: string;
  credits: number;
  dailyCredits: number;
  planId: string;
  gmClaimedDate: string | null;
  gmDailyOverride: number | null;
  gmOverrideExpires: string | null;
  referralBonusRequests: number;
  referralBonusExpires: string | null;
  // Context boost: when set (including "infinity"), gm_max_context is doubled.
  contextBoostExpires: string | null;
  // t/ half-price package: when active, trolllm premium cost is halved.
  tDiscountExpires: string | null;
  // Free-account activation gate. When false on a free user, Bearer-auth
  // requests are rejected (the chat dashboard still works). Paid users
  // and previously-paid users are auto-flipped TRUE.
  isActivated: boolean;
  // Claude-route gate. When false on a free user, any Claude model
  // request is rejected regardless of provider. Paid users and
  // previously-paid users are auto-flipped TRUE on Stripe checkout.
  claudeActivated: boolean;
  // Discord verification gate (free plan). When a free user is unverified and
  // past discordLinkRequiredBy (grace expired), free routing is blocked until
  // they verify at /dashboard/discord. Paid plans and custom keys are exempt.
  discordVerified: boolean;
  discordLinkRequiredBy: string | null;
  // Training-data program: when true the user consented to have their
  // conversations stored for fine-tuning (in exchange for daily expiring
  // credits). Gates training_samples capture in the router.
  trainingConsent: boolean;
  // Per-account billing mode (profiles.billing_mode). "request" (default) bills
  // premium models a flat 1 credit + a premium-pool draw, under the context cap.
  // "payg" bills those same models per token against credits instead — no pool
  // draw and no context cap, but more expensive. Only affects premium
  // providers; na/ + ds/ are already per-token and ignore it.
  billingMode: "request" | "payg";
  // profiles.is_paid — the account bought credits and still holds the floor
  // (MIN_PAID_CREDITS). It is what lets a plan_id='free' account route at all
  // now that the free tier is gone; see src/lib/free-tier.ts. Maintained by DB
  // triggers, never written from the app.
  isPaid: boolean;
  // Per-key overrides (custom/event keys)
  isCustom: boolean;
  customCredits: number | null;
  maxContext: number | null;
  allowedProviders: string[] | null;
  dailyRequestLimit: number | null;
  rateLimitSeconds: number | null;
  // Rolling per-key token cap: at most tokenWindowLimit tokens per
  // tokenWindowSeconds. NULL/0 disables. Enforced in the chat route.
  tokenWindowSeconds: number | null;
  tokenWindowLimit: number | null;
  expiresAt: string | null;
  // Enterprise per-token billing. When pricingMode === "flat_per_token",
  // (prompt+completion) tokens are billed at flatCostPerMTokens USD/1M against
  // custom_credits, bypassing the premium-request pool. Otherwise "standard".
  pricingMode: string;
  flatCostPerMTokens: number | null;
  // Traffic source for usage_logs. "chat" means session-authed (dashboard),
  // "api" means Bearer-authed (public API).
  source: "api" | "chat";
  preset: UserPreset | null;
  presetEnabled: boolean;
  builtinPresetId: string | null;
  lorebook: Lorebook | null;
  lorebookEnabled: boolean;
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
    .select("id, user_id, is_active, is_custom, custom_credits, max_context, allowed_providers, daily_request_limit, rate_limit_seconds, token_window_seconds, token_window_limit, expires_at, pricing_mode, flat_cost_per_m_tokens, last_used, profiles(credits, daily_credits, plan_id, gm_claimed_date, gm_daily_override, gm_override_expires, referral_bonus_requests, referral_bonus_expires, is_activated, claude_activated, preset, preset_enabled, builtin_preset_id, lorebook, lorebook_enabled, context_boost_expires_at, t_discount_expires_at, discord_verified, discord_link_required_by, training_consent, billing_mode, is_paid)")
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

  const profile = result.profiles as unknown as { credits: number; daily_credits: number; plan_id: string; gm_claimed_date: string | null; gm_daily_override: number | null; gm_override_expires: string | null; referral_bonus_requests: number | null; referral_bonus_expires: string | null; is_activated: boolean | null; claude_activated: boolean | null; preset: UserPreset | null; preset_enabled: boolean | null; builtin_preset_id: string | null; lorebook: Lorebook | null; lorebook_enabled: boolean | null; context_boost_expires_at: string | null; t_discount_expires_at: string | null; discord_verified: boolean | null; discord_link_required_by: string | null; training_consent: boolean | null; billing_mode: string | null; is_paid: boolean | null };

  return {
    keyId: result.id,
    userId: result.user_id,
    credits: profile?.credits ?? 0,
    dailyCredits: profile?.daily_credits ?? 0,
    planId: profile?.plan_id ?? "free",
    gmClaimedDate: profile?.gm_claimed_date ?? null,
    gmDailyOverride: profile?.gm_daily_override ?? null,
    gmOverrideExpires: profile?.gm_override_expires ?? null,
    referralBonusRequests: profile?.referral_bonus_requests ?? 0,
    referralBonusExpires: profile?.referral_bonus_expires ?? null,
    contextBoostExpires: profile?.context_boost_expires_at ?? null,
    tDiscountExpires: profile?.t_discount_expires_at ?? null,
    isActivated: profile?.is_activated ?? false,
    claudeActivated: profile?.claude_activated ?? false,
    discordVerified: profile?.discord_verified ?? false,
    discordLinkRequiredBy: profile?.discord_link_required_by ?? null,
    trainingConsent: profile?.training_consent ?? false,
    billingMode: profile?.billing_mode === "payg" ? "payg" : "request",
    isPaid: profile?.is_paid ?? false,
    isCustom: result.is_custom ?? false,
    customCredits: result.custom_credits ?? null,
    maxContext: result.max_context ?? null,
    allowedProviders: result.allowed_providers ?? null,
    dailyRequestLimit: result.daily_request_limit ?? null,
    rateLimitSeconds: result.rate_limit_seconds ?? null,
    tokenWindowSeconds: (result as { token_window_seconds?: number | null }).token_window_seconds ?? null,
    tokenWindowLimit: (result as { token_window_limit?: number | null }).token_window_limit ?? null,
    expiresAt: result.expires_at ?? null,
    pricingMode: (result as { pricing_mode?: string | null }).pricing_mode ?? "standard",
    flatCostPerMTokens: (result as { flat_cost_per_m_tokens?: number | null }).flat_cost_per_m_tokens ?? null,
    source: "api",
    preset: profile?.preset ?? null,
    presetEnabled: profile?.preset_enabled ?? false,
    builtinPresetId: profile?.builtin_preset_id ?? null,
    lorebook: profile?.lorebook ?? null,
    lorebookEnabled: profile?.lorebook_enabled ?? false,
  };
}

/**
 * Build an ApiKeyInfo from a Supabase session cookie. Used by the in-dashboard
 * chat so /v1/chat/completions can treat the request identically to an API
 * call — same plan limits, premium claims, rate limits, billing. The only
 * differences: keyId is null (logged as api_key_id=null) and source="chat".
 */
export async function validateSession(): Promise<ApiKeyInfo | null> {
  const userSb = await createServerSupabase();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("credits, daily_credits, plan_id, gm_claimed_date, gm_daily_override, gm_override_expires, referral_bonus_requests, referral_bonus_expires, is_activated, claude_activated, preset, preset_enabled, builtin_preset_id, lorebook, lorebook_enabled, context_boost_expires_at, t_discount_expires_at, discord_verified, discord_link_required_by, training_consent, billing_mode, is_paid")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    keyId: null,
    userId: user.id,
    credits: profile.credits ?? 0,
    dailyCredits: profile.daily_credits ?? 0,
    planId: profile.plan_id ?? "free",
    gmClaimedDate: profile.gm_claimed_date ?? null,
    gmDailyOverride: profile.gm_daily_override ?? null,
    gmOverrideExpires: profile.gm_override_expires ?? null,
    referralBonusRequests: profile.referral_bonus_requests ?? 0,
    referralBonusExpires: profile.referral_bonus_expires ?? null,
    contextBoostExpires: (profile as unknown as { context_boost_expires_at?: string | null }).context_boost_expires_at ?? null,
    tDiscountExpires: (profile as unknown as { t_discount_expires_at?: string | null }).t_discount_expires_at ?? null,
    isActivated: profile.is_activated ?? false,
    claudeActivated: profile.claude_activated ?? false,
    discordVerified: (profile as unknown as { discord_verified?: boolean | null }).discord_verified ?? false,
    discordLinkRequiredBy: (profile as unknown as { discord_link_required_by?: string | null }).discord_link_required_by ?? null,
    trainingConsent: (profile as unknown as { training_consent?: boolean | null }).training_consent ?? false,
    billingMode:
      (profile as unknown as { billing_mode?: string | null }).billing_mode === "payg"
        ? "payg"
        : "request",
    isPaid: (profile as unknown as { is_paid?: boolean | null }).is_paid ?? false,
    isCustom: false,
    customCredits: null,
    maxContext: null,
    allowedProviders: null,
    dailyRequestLimit: null,
    rateLimitSeconds: null,
    tokenWindowSeconds: null,
    tokenWindowLimit: null,
    expiresAt: null,
    pricingMode: "standard",
    flatCostPerMTokens: null,
    source: "chat",
    preset: (profile as unknown as { preset?: UserPreset | null }).preset ?? null,
    presetEnabled: (profile as unknown as { preset_enabled?: boolean | null }).preset_enabled ?? false,
    builtinPresetId: (profile as unknown as { builtin_preset_id?: string | null }).builtin_preset_id ?? null,
    lorebook: (profile as unknown as { lorebook?: Lorebook | null }).lorebook ?? null,
    lorebookEnabled: (profile as unknown as { lorebook_enabled?: boolean | null }).lorebook_enabled ?? false,
  };
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
