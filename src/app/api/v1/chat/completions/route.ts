import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, validateSession } from "@/lib/auth";
import { calculateCredits, flatTokenCredits, paygCredits, isPaygPriced } from "@/lib/credits";
import { estimateTokens, estimatePromptTokens, floorPromptTokens } from "@/lib/token-estimator";
import { getProvider } from "@/lib/providers";
import {
  isPremiumProvider as isPremiumProviderName,
  isFreeProvider as isFreeProviderName,
  isFlatRateProvider as isFlatRateProviderName,
} from "@/lib/providers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { evaluateBanStatus } from "@/lib/ban";
import {
  getContextAdjustedPremiumRequestCost,
  getCustomKeyNoCreditsError,
  getNoPaidBalanceError,
  isApiKeyAuthHeader,
} from "@/lib/chat-preflight";
import {
  CLAUDE_BLOCK_MESSAGE,
  CLAUDE_NOT_ACTIVATED_MESSAGE,
  CLAUDE_PAID_ONLY_MESSAGE,
  claudeActivationApplies,
  claudePaidOnlyApplies,
  isAllowedClaudeProvider,
  isClaudeModel,
} from "@/lib/claude-block";
import {
  moderateMessages,
  recordModerationReview,
} from "@/lib/content-moderation";
import { captureTrainingSample } from "@/lib/training-capture";
import { applyPreset, applyLorebook } from "@/lib/preset";
import { getBuiltinPreset } from "@/lib/builtinPresets";
import { tryPcFailover } from "@/lib/pc-failover";
import { TtlCache } from "@/lib/db-cache";
import { getPlanLimits } from "@/lib/plan-cache";
import {
  isFreeTierBlocked,
  isPaidAccount,
  FREE_TIER_BLOCKED_PAYLOAD,
  FREE_TIER_BLOCKED_STATUS,
} from "@/lib/free-tier";

export const runtime = "nodejs";
// NOTE: If the platform kills a streaming request mid-flight, the `flush()`
// handler and the `catch` block will NOT fire. The pre-reserved credits will be
// stuck as "charged" with no usage log. Consider a periodic reconciliation job
// to detect orphaned reservations.
export const maxDuration = 300;

// Optional promotional free-pool limits for airforce deepseek-v3.2.
// Disabled unless AETHER_FREE_PROMOS_ENABLED=true.
const PER_USER_DAILY_TOKEN_LIMIT = 200_000;
const GLOBAL_DAILY_TOKEN_POOL = 10_000_000;
const DEFAULT_STREAM_RESERVATION_COMPLETION_TOKENS = 4096;
const MAX_STREAM_RESERVATION_COMPLETION_TOKENS = 32_768;
// Cost in credits to purchase one extra premium request when the daily limit is hit.
const PREMIUM_OVERAGE_COST = 100;
// Enterprise (flat_per_token) keys hard-stop at 0 balance (402). This is an
// early-warning floor: when a key settles below it, log a warning so the
// operator can top up before the client is cut off. 1.5M credits ≈ 50M tokens
// at $3/M. Override with ENTERPRISE_LOW_BALANCE_CREDITS.
const ENTERPRISE_LOW_BALANCE_CREDITS = Number(process.env.ENTERPRISE_LOW_BALANCE_CREDITS) || 1_500_000;
// Fair-use guard for plan-"unlimited" providers (e.g. r/ RiftAI on paid plans).
// AI cost is ~0, but each request still costs infra (Supabase + moderation + CPU),
// so cap a single account to protect against abuse/resale. Tune freely.
const FAIRUSE_DAILY_CAP = 1500;
const FAIRUSE_RATE_LIMIT_SECONDS = 0;
const FREE_INCLUDED_USAGE_ENABLED =
  process.env.AETHER_FREE_INCLUDED_USAGE_ENABLED === "true";
const FREE_PROMOS_ENABLED = process.env.AETHER_FREE_PROMOS_ENABLED === "true";

// Hot-path read caches. Models change on admin timescales (toggling
// is_active, editing costs), so a 60s-stale row is invisible to users but
// saves one DB read on every completion. Misses are NOT cached — a
// just-activated model works immediately. Free-event lookups cache only the
// "no active event" result: a found event carries live token_pool_used
// state and must always be re-read so pool exhaustion applies in real time.
const modelRowCache = new TtlCache<Record<string, unknown>>(60_000);
const noFreeEventCache = new TtlCache<true>(60_000);
// TEMP (2026-05-26): DLab (db/) free + unlimited promo while a donated 24h
// key lasts. Deliberately independent of FREE_PROMOS_ENABLED so it does NOT
// reopen the other paused promos (free events, riftai gemini, deepseek free).
// Unset this flag (or let the upstream key die) to revert.
const DLAB_FREE_UNLIMITED = process.env.DLAB_FREE_UNLIMITED === "true";

// or/ (Orbit) free + unlimited, independent of FREE_PROMOS_ENABLED (same
// self-contained pattern as DLAB_FREE_UNLIMITED). Routes as zero-cost premium →
// no credits, no premium pool, no daily cap; only a context cap applies.
// 2026-06-24: scoped to the top tiers (ultra/ultimate/max) — see
// ORBIT_ZENLLM_FREE_PLANS below; cheaper plans now bill 1 premium request.
// This env flag is the global kill switch (set "false" to disable for everyone).
const ORBIT_FREE_UNLIMITED = process.env.ORBIT_FREE_UNLIMITED !== "false";
const ORBIT_FREE_CONTEXT = 32768;   // free plans
const ORBIT_PAID_CONTEXT = 131072;  // paid plans

// z/ (ZenLLM) free promo: same self-contained zero-cost pattern as or/.
// Routes as zero-cost premium → no credits, no premium pool, no daily cap.
// The only guard is a context cap: 32k for free plans, UNLIMITED for paid
// (ZENLLM_PAID_CONTEXT = 0 → no cap).
// 2026-06-24: scoped to the top tiers (ultra/ultimate/max) — see
// ORBIT_ZENLLM_FREE_PLANS below; cheaper plans now bill 1 premium request.
//
// 2026-09-05: DEFAULT FLIPPED TO OFF (opt-in via ZENLLM_FREE_UNLIMITED=true).
// The promo made sense while z/ was a flat enterprise key where an extra token
// cost us nothing. ZenLLM now bills PER TOKEN, so zero-cost + unlimited context
// on ultra/ultimate/max would hand a 200k-context Opus 4.8 call (~$0.32 of
// upstream) away for free. The flag is kept so the promo can be turned back on
// deliberately if we ever get a flat contract again.
const ZENLLM_FREE_UNLIMITED = process.env.ZENLLM_FREE_UNLIMITED === "true";
const ZENLLM_FREE_CONTEXT = 32768;  // free plans
const ZENLLM_PAID_CONTEXT = 0;      // paid plans = unlimited (0 = no cap)

type StreamChargeReservation = {
  reservedCredits: number;
  balanceAfterReserve: number;
};

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
};

// TrollLLM (and other Anthropic-fronting gateways) may expose cache counters
// either in OpenAI's `prompt_tokens_details.cached_tokens` shape or in
// Anthropic's `cache_read_input_tokens` / `cache_creation_input_tokens` shape.
// Accept both so billing matches whichever upstream format leaks through.
//
// IMPORTANT: an upstream that mis-reports `cache_read = prompt_tokens` would
// drive billable fresh tokens to ~0 (cache pricing is much lower than input).
// We clamp the sum so it can never exceed the prompt; the caller still pays
// for any prompt token, just at cache rate vs input rate.
function extractCacheTokens(
  usage: UsageLike | undefined,
  promptTokens: number = Infinity
): { read: number; write: number } {
  if (!usage) return { read: 0, write: 0 };
  let read =
    Number(usage.cache_read_input_tokens) ||
    Number(usage.prompt_tokens_details?.cached_tokens) ||
    0;
  let write =
    Number(usage.cache_creation_input_tokens) ||
    Number(usage.prompt_tokens_details?.cache_creation_tokens) ||
    0;
  read = read > 0 ? read : 0;
  write = write > 0 ? write : 0;

  // Cap to prompt size so a malicious/buggy upstream can't drive the bill
  // to zero by inflating cache counters above prompt_tokens.
  if (Number.isFinite(promptTokens) && promptTokens > 0) {
    if (read + write > promptTokens) {
      // Trim write first (more aggressive lower price), then read.
      const overflow = read + write - promptTokens;
      const wTrim = Math.min(write, overflow);
      write -= wTrim;
      const remaining = overflow - wTrim;
      if (remaining > 0) read = Math.max(0, read - remaining);
    }
  }
  return { read, write };
}

function extractCompletionText(payload: unknown): string {
  const data = payload as { choices?: Array<{ message?: { content?: unknown } }> };
  const text = data?.choices?.[0]?.message?.content;

  if (typeof text === "string") {
    return text;
  }

  if (Array.isArray(text)) {
    return text
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const maybeText = (part as { text?: unknown }).text;
          return typeof maybeText === "string" ? maybeText : "";
        }
        return "";
      })
      .join("");
  }

  return "";
}

function getRequestedCompletionTokens(body: Record<string, unknown>): number | null {
  const candidates = [body.max_completion_tokens, body.max_tokens];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
  }

  return null;
}

function shouldBypassIncludedPremiumRequests(keyInfo: {
  planId: string;
  isCustom: boolean;
}): boolean {
  return (
    !FREE_INCLUDED_USAGE_ENABLED &&
    !keyInfo.isCustom &&
    keyInfo.planId === "free"
  );
}

function shouldUsePaidOnlyCredits(keyInfo: {
  planId: string;
  isCustom: boolean;
}): boolean {
  return !keyInfo.isCustom && keyInfo.planId === "free";
}

function getAvailableBillableCredits(keyInfo: {
  credits: number;
  dailyCredits: number;
  planId: string;
  isCustom: boolean;
}): number {
  return shouldUsePaidOnlyCredits(keyInfo)
    ? keyInfo.credits
    : keyInfo.credits + keyInfo.dailyCredits;
}

function getIncludedPremiumRequestLimit(planId: string, dbLimit: number | null | undefined): number {
  if (planId === "free" && FREE_INCLUDED_USAGE_ENABLED) {
    return 15;
  }
  return dbLimit ?? 15;
}

async function deductUserCredits(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  amount: number,
  paidOnly: boolean
): Promise<{ data: unknown; error: { message?: string } | null }> {
  const rpcName = paidOnly ? "deduct_paid_credits" : "deduct_credits";
  const { data, error } = await supabase.rpc(rpcName, {
    p_user_id: userId,
    p_amount: amount,
  });
  return { data, error };
}

// OpenAI's reasoning families (gpt-5+, o1/o3/o4) reject `max_tokens` and
// require `max_completion_tokens`. RiftAI's gpt-5.5 hits this directly;
// TrollLLM accepts both, so normalizing here is safe across resellers.
function isReasoningModel(modelId: string): boolean {
  return /^(gpt-[5-9]|o[134])(\b|[-._])/i.test(modelId);
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // 0. Read + size-cap the request body once. `req.body` is a one-shot
  // stream — it cannot be read twice — and we need the bytes both to
  // forward to the PC (failover, step 0b) and for local handling. See the
  // size-cap rationale below.
  //
  // IMPORTANT: The `Content-Length` header is attacker-controlled (can be
  // omitted entirely or lied about with chunked transfer), so we cannot
  // trust it as a guard. We read the body as a byte stream and enforce the
  // cap while accumulating, aborting the moment we exceed it. A 200-page
  // PDF in base64 is ~2-3MB; anything past ~10MB is almost certainly an
  // attempt to push past the context cap with binary the estimator can't
  // measure.
  const MAX_BODY_BYTES = 10 * 1024 * 1024;
  let rawBody: Uint8Array;
  try {
    const reader = req.body?.getReader();
    if (!reader) {
      return NextResponse.json(
        { error: { message: "Empty request body", type: "invalid_request" } },
        { status: 400 }
      );
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          return NextResponse.json(
            {
              error: {
                message: `Request body too large. Max ${MAX_BODY_BYTES / 1024 / 1024} MB.`,
                type: "invalid_request",
              },
            },
            { status: 413 }
          );
        }
        chunks.push(value);
      }
    }
    rawBody = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      rawBody.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch {
    return NextResponse.json(
      { error: { message: "Failed to read request body", type: "invalid_request" } },
      { status: 400 }
    );
  }

  // 0b. PC failover. The Cloudflare edge worker should be the primary traffic
  // director in production. This env-gated fallback remains for direct cloud
  // app deployments and local ops: if PC_ORIGIN_URL is set, forward the
  // buffered request to the home-PC origin first. If the PC serves it, we skip
  // local DB/upstream work. If the PC is unreachable/unhealthy,
  // tryPcFailover() returns null and we continue locally with `rawBody`.
  const pcResponse = await tryPcFailover(req, rawBody);
  if (pcResponse) return pcResponse;

  // 1. Authenticate — Bearer API key OR Supabase session (in-dashboard chat).
  // Session auth lets the internal chat UI reuse this endpoint without
  // minting/storing a plaintext API key; validateSession() builds a synthetic
  // keyInfo (keyId=null, source="chat") that flows through the same billing
  // and rate-limit paths as a real API call.
  const authHeader = req.headers.get("authorization");
  const isApiKeyAuth = isApiKeyAuthHeader(authHeader);
  const apiKeyToken = isApiKeyAuth ? (authHeader ?? "").slice(7) : null;
  let keyInfo;
  if (isApiKeyAuth) {
    keyInfo = await validateApiKey(apiKeyToken!);
    if (!keyInfo) {
      return NextResponse.json(
        { error: { message: "Invalid API key", type: "auth_error" } },
        { status: 401 }
      );
    }
  } else {
    // Session auth path: the client is our own dashboard using cookies.
    // Cookies are sent automatically by browsers on cross-origin requests,
    // so any cross-site POST to this endpoint would drain the victim's
    // credits if we didn't require a CSRF token. `X-Requested-With` cannot
    // be sent by a simple HTML form and requires CORS preflight which our
    // middleware only grants to the allowlist.
    const csrfError = requireCsrf(req);
    if (csrfError) return csrfError;

    keyInfo = await validateSession();
    if (!keyInfo) {
      return NextResponse.json(
        { error: { message: "Missing Authorization header", type: "auth_error" } },
        { status: 401 }
      );
    }
  }

  // Ban gate. Block requests whose client IP — or any fingerprint/IP the server
  // has recorded for this user in `device_fingerprints` — appears in
  // `banned_fingerprints`. Fail-open inside evaluateBanStatus on DB errors.
  // Runs right after auth so a banned user can't spend credits or reach a
  // provider regardless of activation/plan state.
  const banDecision = await evaluateBanStatus({
    headers: req.headers,
    userId: keyInfo.userId,
    fingerprint: req.headers.get("x-fingerprint"),
  });
  if (banDecision?.blocked) {
    return NextResponse.json(
      { error: { message: banDecision.reason, type: "account_banned" } },
      { status: banDecision.statusCode }
    );
  }

  // Free tier removed (2026-08-21).
  //
  // The `free` plan no longer routes: not through API keys, not through the
  // dashboard chat. This replaces the two gates that used to police free
  // routing (admin `is_activated` flip + Discord ownership verification) —
  // both existed to make free access sustainable, and there is no free access
  // left to police. Custom keys are exempt (admin-minted, own credit pool).
  //
  // Everything downstream that still branches on `planId === "free"`
  // (included premium pool, paid-only credits, or/ + z/ free context caps) is
  // now unreachable for non-custom keys; it is left in place so flipping this
  // gate off restores the old behaviour intact.
  if (isFreeTierBlocked(keyInfo)) {
    return NextResponse.json(FREE_TIER_BLOCKED_PAYLOAD, { status: FREE_TIER_BLOCKED_STATUS });
  }

  // Extra hardening: if a custom key has exhausted credits, reject before
  // parsing payload or touching upstream selection paths.
  const customKeyNoCreditsError = keyInfo.isCustom
    ? getCustomKeyNoCreditsError(keyInfo.customCredits)
    : null;
  if (customKeyNoCreditsError) {
    return NextResponse.json(customKeyNoCreditsError.payload, { status: customKeyNoCreditsError.status });
  }

  // 3. Parse request body. `rawBody` was read + size-capped at step 0.
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request" } },
      { status: 400 }
    );
  }

  const modelId = body.model as string;
  const messages = body.messages as Array<{ role: string; content: string }>;
  const stream = body.stream === true;

  if (!modelId || !messages?.length) {
    return NextResponse.json(
      { error: { message: "model and messages are required", type: "invalid_request" } },
      { status: 400 }
    );
  }

  // 3.5. Moderation queue — only the `sexual/minors` category is checked;
  // everything else passes through. Fails OPEN on transient moderator errors.
  //
  // A flag NO LONGER bans, blocks, or disables keys. The omni-moderation
  // boolean fires at a low threshold and was permanently nuking paying
  // accounts on legitimate adult roleplay (false positives). Instead we
  // silently queue the flagged text + context to moderation_reviews and let
  // the request through; an admin reviews the queue and decides whether to ban.
  const moderation = await moderateMessages(messages as { role: string; content: unknown }[]);
  if (moderation.flagged) {
    await recordModerationReview({
      userId: keyInfo.userId,
      source: keyInfo.source,
      flaggedItems: moderation.flaggedItems,
      messages: messages as { role: string; content: unknown }[],
    });
  }

  // 4. Look up model (60s cache; see modelRowCache above).
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any = modelRowCache.get(modelId) ?? null;
  if (!model) {
    const { data: modelRow } = await supabase
      .from("models")
      .select("*")
      .eq("id", modelId)
      .eq("is_active", true)
      .single();
    if (modelRow) {
      model = modelRow;
      modelRowCache.set(modelId, modelRow);
    }
  }

  if (!model) {
    return NextResponse.json(
      { error: { message: "Model not found or unavailable", type: "invalid_request" } },
      { status: 404 }
    );
  }

  // Los modelos de imagen/video viven en la misma tabla pero no tienen
  // adaptador de chat: sin este corte, getProvider("comfy") devolvería
  // undefined y el usuario vería un 503 genérico en vez del endpoint correcto.
  if (model.modality && model.modality !== "text") {
    return NextResponse.json(
      {
        error: {
          message: `${model.id} is an ${model.modality} generation model. Use POST /v1/images/generations or /v1/media/jobs instead.`,
          type: "invalid_request",
        },
      },
      { status: 400 }
    );
  }

  // 5. Get provider
  const provider = getProvider(model.provider);
  if (!provider) {
    return NextResponse.json(
      { error: { message: "This model is currently unavailable.", type: "server_error" } },
      { status: 503 }
    );
  }

  // Claude policy gate. Only upstreams listed in claude-block.ts are
  // approved to route Claude. Paid-plan-only rule applies to most of
  // them; trolllm is exempt while we drain expiring keys.
  if (isClaudeModel(model)) {
    if (!isAllowedClaudeProvider(model.provider)) {
      return NextResponse.json(
        { error: { message: CLAUDE_BLOCK_MESSAGE, type: "model_blocked" } },
        { status: 403 }
      );
    }
    // TEMP (2026-05-26): during the db/ (DLab) free+unlimited promo, db/ is
    // open to everyone — free plan included — so skip BOTH the paid-plan-only
    // rule and the per-user claude_activated gate for db/ while the flag is on.
    const dlabFreePromo = DLAB_FREE_UNLIMITED && model.provider === "dlab";
    if (!dlabFreePromo) {
      // "Paid" now includes pay-as-you-go accounts (purchased credits), not
      // just subscribers — see isPaidAccount in src/lib/free-tier.ts.
      if (!isPaidAccount(keyInfo) && claudePaidOnlyApplies(model.provider)) {
        return NextResponse.json(
          { error: { message: CLAUDE_PAID_ONLY_MESSAGE, type: "plan_restricted" } },
          { status: 403 }
        );
      }
      // Per-user Claude activation gate. Mirrors the API-key
      // `is_activated` flow: free users start FALSE and an admin must
      // flip them; paid users + anyone with a prior purchase are
      // grandfathered/auto-flipped TRUE on Stripe checkout. Custom
      // keys bypass — they're admin-minted with their own controls.
      // or/ also bypasses (flat-rate upstream, no per-user fairness
      // load) via CLAUDE_ACTIVATION_BYPASS.
      if (
        !keyInfo.isCustom &&
        !keyInfo.claudeActivated &&
        claudeActivationApplies(model.provider)
      ) {
        return NextResponse.json(
          { error: { message: CLAUDE_NOT_ACTIVATED_MESSAGE, type: "claude_not_activated" } },
          { status: 403 }
        );
      }
    }
  }

  const isPremiumProvider = isPremiumProviderName(model.provider);
  const isFlatRateProvider = isFlatRateProviderName(model.provider);
  // Enterprise per-token billing: a custom key with pricing_mode='flat_per_token'
  // bills (prompt+completion) tokens at flatCostPerMTokens USD/1M against its
  // custom_credits pool. Custom keys already skip the premium-pool gate (they
  // take the keyInfo.isCustom branch), so this only overrides the per-request
  // flat charge with a token-metered one in the reservation + settlement.
  const isFlatPerTokenKey =
    keyInfo.isCustom &&
    keyInfo.pricingMode === "flat_per_token" &&
    (keyInfo.flatCostPerMTokens ?? 0) > 0;
  const flatRatePerM = keyInfo.flatCostPerMTokens ?? 0;
  // Context boost: user purchased 2× context multiplier (temporary or permanent).
  const isContextBoosted =
    !!keyInfo.contextBoostExpires &&
    (keyInfo.contextBoostExpires === "infinity" || new Date(keyInfo.contextBoostExpires) > new Date());

  // TEMP (2026-05-02): Gemini models from r/ are free while we evaluate capacity.
  // Remove this block once the promo period ends.
  const isRiftaiGeminiFree =
    FREE_PROMOS_ENABLED &&
    model.provider === "riftai" &&
    (model.upstream_model_id || modelId).toLowerCase().includes("gemini");

  // TEMP (2026-05-26): db/ (DLab) is fully free + unlimited while the donated
  // 24h key lasts. Routes as zero-cost regardless of its catalog cost, so no
  // credits, no premium-request pool, and no daily request cap are consumed —
  // only the plan's context cap (≈line 1065) still applies as an abuse guard.
  // Gated by its own DLAB_FREE_UNLIMITED flag so the rest of the paused promos
  // stay off.
  const isDlabFreeUnlimited = DLAB_FREE_UNLIMITED && model.provider === "dlab";

  // 2026-06-24: or/ + z/ free-unlimited is now restricted to the top consumer
  // tiers (ultra / ultimate / max) — those plans keep the exact zero-cost +
  // wide-context behavior they had. Every cheaper plan (free, mod, pro, creator,
  // master) falls through to normal premium-pool billing (1 premium request per
  // call, per the flattened catalog cost). Custom/enterprise keys are unaffected
  // (their own billing path) so the B2B per-token contract keeps working.
  const ORBIT_ZENLLM_FREE_PLANS = new Set(["ultra", "ultimate", "max"]);
  const orbitZenllmFreeEligible =
    keyInfo.isCustom || ORBIT_ZENLLM_FREE_PLANS.has(keyInfo.planId);

  // or/ (Orbit) free + unlimited: routes as zero-cost premium regardless of its
  // catalog price, so no credits / premium pool / daily cap are consumed — only
  // the orbit context cap below applies. Catalog cost is left untouched so it
  // reverts cleanly by flipping ORBIT_FREE_UNLIMITED off.
  const isOrbitFreeUnlimited =
    ORBIT_FREE_UNLIMITED && model.provider === "orbit" && orbitZenllmFreeEligible;

  // z/ (ZenLLM) free promo: routes as zero-cost premium regardless of its
  // catalog price, so no credits / premium pool / daily cap are consumed — only
  // the zenllm context cap below applies. Catalog cost is left untouched so it
  // reverts cleanly by flipping ZENLLM_FREE_UNLIMITED off.
  const isZenllmFreeUnlimited =
    ZENLLM_FREE_UNLIMITED && model.provider === "zenllm" && orbitZenllmFreeEligible;

  // Zero-cost premium models (cost_per_m_input=0 + premium_request_cost=0) route
  // as free — no credits or premium-request budget consumed. Revert by restoring
  // cost/margin values in the models table.
  const isZeroCostPremium =
    isDlabFreeUnlimited ||
    isOrbitFreeUnlimited ||
    isZenllmFreeUnlimited ||
    (FREE_PROMOS_ENABLED &&
      isPremiumProvider && (
        (Number(model.cost_per_m_input) === 0 && Number(model.premium_request_cost) === 0) ||
        isRiftaiGeminiFree
      ));
  // Same for flat-rate (openrouter): premium_request_cost=0 means free promo.
  // Without this short-circuit we'd call deduct_credits(0), which the RPC
  // rejects with -1 → 402 "Insufficient credits, credits_required: 0".
  const isZeroCostFlatRate =
    FREE_PROMOS_ENABLED &&
    isFlatRateProvider &&
    Number(model.premium_request_cost) === 0;

  const isUnbillableZeroCostModel =
    !FREE_PROMOS_ENABLED &&
    !keyInfo.isCustom &&
    Number(model.cost_per_m_input) === 0 &&
    Number(model.cost_per_m_output) === 0 &&
    Number(model.premium_request_cost ?? 0) === 0;

  if (isUnbillableZeroCostModel) {
    return NextResponse.json(
      {
        error: {
          message:
            "Free model promotions are paused while capacity is adjusted. Buy credits or choose a paid model to continue.",
          type: "plan_restricted",
        },
      },
      { status: 402 }
    );
  }

  // Pay-as-you-go (profiles.billing_mode = 'payg'). The account opted into
  // per-token billing for premium models: charge credits per token instead of
  // drawing the daily premium pool, and lift the plan context cap — that cap
  // exists to ration the pool, and a PAYG user pays for every token they send.
  //
  // Deliberately excluded:
  //   - non-premium (na/, ds/): genuine per-token upstreams already billed at
  //     their real cost + margin. Pricing them off the PAYG table would sell
  //     below cost, so they keep the standard path regardless of the toggle.
  //   - zero-cost promos and free pools/events: free stays free (isFreePool
  //     short-circuits the reservation and settlement below).
  //   - custom/enterprise keys: they carry their own contract billing
  //     (flat_per_token / custom_credits).
  //   - models with no PAYG rates seeded (payg_credits_per_m_* = 0).
  const isPaygRequest =
    keyInfo.billingMode === "payg" &&
    isPremiumProvider &&
    !isZeroCostPremium &&
    !keyInfo.isCustom &&
    isPaygPriced(model);

  // 5.4. Active free event lookup (admin-created pools that make a model
  // prefix free for a set of plans, with their own per-user limits).
  // Custom keys have their own quotas and are not eligible for events.
  type FreeEvent = {
    id: string;
    model_prefix: string;
    starts_at: string;
    ends_at: string;
    token_pool_limit: number;
    token_pool_used: number;
    per_user_msg_limit: number;
    max_context: number;
    rate_limit_seconds: number;
    target_plan_ids: string[] | null;
  };
  let activeEvent: FreeEvent | null = null;
  let isFreePool = false;
  let activeEventId: string | null = null;

  const freeEventCacheKey = `${modelId}|${keyInfo.planId}`;
  if (
    FREE_PROMOS_ENABLED &&
    !keyInfo.isCustom &&
    // "No active event" is the common case and is safe to cache for 60s
    // (a newly launched event just takes ≤60s/node to kick in). Found
    // events are never cached — see noFreeEventCache above.
    !noFreeEventCache.get(freeEventCacheKey)
  ) {
    const { data: eventRow, error: eventLookupError } = await supabase.rpc("find_active_free_event", {
      p_model_id: modelId,
      p_plan_id: keyInfo.planId,
    });

    if (eventLookupError) {
      console.error("Failed to resolve active free event:", eventLookupError.message);
    } else if (eventRow && (eventRow as { id?: string | null }).id) {
      // PostgREST serializes a NULL composite return value as an object with
      // all fields null ({ id: null, ... }) — which is truthy in JS. Guard on
      // the `id` field so we only treat the row as a real event when it exists.
      // Without this check, `activeEvent` becomes a ghost row, `isFreePool`
      // flips to true, credit reservation is skipped, and every request for a
      // non-custom user is effectively free.
      activeEvent = eventRow as unknown as FreeEvent;
    } else {
      noFreeEventCache.set(freeEventCacheKey, true);
    }
  }

  if (activeEvent) {
    // Context cap for this event must run before the atomic reservation.
    // Otherwise an oversized request can burn a per-user event slot and
    // update last_request_at even though it returns 413.
    if (activeEvent.max_context > 0) {
      const estimatedContext = estimatePromptTokens(body);
      if (estimatedContext > activeEvent.max_context) {
        return NextResponse.json(
          {
            error: {
              message: `Context too long (~${estimatedContext} tokens). This event allows ${activeEvent.max_context} tokens max.`,
              type: "context_limit",
            },
          },
          { status: 413 }
        );
      }
    }

    // Atomic per-event reservation: rate limit + per-user message cap +
    // pool-exhaustion check happen inside one transaction with row locks.
    // Replaces the prior SELECT/COUNT-on-usage_logs approach which had a
    // multi-second TOCTOU window during which N parallel requests could
    // all pass before any of them logged a row.
    const { data: reserveResult, error: reserveErr } = await supabase.rpc(
      "reserve_free_event_request",
      { p_event_id: activeEvent.id, p_user_id: keyInfo.userId }
    );

    if (reserveErr) {
      console.error("Free event reservation RPC failed:", reserveErr.message);
      return NextResponse.json(
        { error: { message: "Failed to check event quota", type: "server_error" } },
        { status: 500 }
      );
    }

    const res = reserveResult as { status?: string; retry_after_seconds?: number; limit?: number };
    if (res?.status === "rate_limited") {
      const retryAfter = res.retry_after_seconds ?? activeEvent.rate_limit_seconds ?? 60;
      return NextResponse.json(
        {
          error: {
            message: `Event rate limit: 1 request per ${activeEvent.rate_limit_seconds}s. Try again in ${retryAfter}s.`,
            type: "rate_limit",
          },
        },
        { status: 429, headers: { "Retry-After": String(Math.max(retryAfter, 1)) } }
      );
    }
    if (res?.status === "msg_limit") {
      return NextResponse.json(
        {
          error: {
            message: `Event message limit reached (${activeEvent.per_user_msg_limit} messages for this event).`,
            type: "rate_limit",
          },
        },
        { status: 429 }
      );
    }
    if (res?.status === "pool_exhausted") {
      return NextResponse.json(
        {
          error: {
            message: "This event's free token pool has been exhausted. Use the model normally to continue.",
            type: "rate_limit",
          },
        },
        { status: 429 }
      );
    }
    if (res?.status === "inactive" || res?.status === "not_found") {
      // Event ended between lookup and reservation — treat as if no event.
      activeEvent = null;
    }

    if (activeEvent) {
      isFreePool = true;
      activeEventId = activeEvent.id;
    }
  }

  // 5.4b. PAYG-only models (models.payg_only). Their upstream bills us per
  // token at a rate the daily premium pool cannot absorb: priced honestly
  // against the cheapest paid plan ($8 / 2250 premium requests = $0.00356 per
  // request), Opus 4.8 lands at 20 premium requests a call and Fable 5 at 40 —
  // numbers that make no sense in request mode. So they are offered only on
  // per-token billing, where every token carries its own margin.
  //
  // Custom/enterprise keys (own contract), free pools/events and zero-cost
  // promos are unaffected: none of them draw the premium pool either.
  if (
    model.payg_only &&
    !isPaygRequest &&
    !keyInfo.isCustom &&
    !isFreePool &&
    !isZeroCostPremium
  ) {
    return NextResponse.json(
      {
        error: {
          message:
            `${modelId} is only available on pay-as-you-go billing (charged per token, no context cap). ` +
            `Switch your account to Pay as you go in Settings to use it.`,
          type: "billing_error",
          billing_mode_required: "payg",
        },
      },
      { status: 402 }
    );
  }

  // Reservation flags so refundReservation() can roll back request counters
  // (premium RPD / custom-key RPD) on upstream failure, independently of the
  // credit reservation.
  let premiumRequestReserved = false;
  let premiumReservedCost = 0;
  let premiumRequestCostForUsage = 0;
  let customKeyRequestReserved = false;
  // Plan-"unlimited" provider (e.g. r/ on paid plans): bypasses the premium pool,
  // guarded by a separate fair-use counter. Billed as free; logs 0 premium cost.
  let fairUseReserved = false;
  let isPlanUnlimited = false;
  let premiumOveragePurchased = false;
  // Combined balance (daily + permanent) right after the overage deduct,
  // captured so the overage charge can be written to the transaction ledger.
  let premiumOverageBalance = 0;

  // Resolve the requested completion budget. Oversize requests are CLAMPED to
  // MAX_STREAM_RESERVATION_COMPLETION_TOKENS at forward time (reservation +
  // upstream both use the clamped value below) rather than rejected with a 400.
  // Clients (e.g. SillyTavern) routinely send their entire context window as
  // max_tokens; a hard reject just surfaces as "something went wrong" in chat.
  // Clamping is safe: real completions almost never approach 32k tokens, and
  // the credit reservation is bounded by the same ceiling either way.
  const requestedCompletionTokens = getRequestedCompletionTokens(body);

  // 5.5b. Custom key checks — custom keys bypass plan restrictions and use their own limits
  if (keyInfo.isCustom) {
    // Provider allowlist
    if (keyInfo.allowedProviders && !keyInfo.allowedProviders.includes(model.provider)) {
      return NextResponse.json(
        { error: { message: "This key does not have access to this model.", type: "plan_restricted" } },
        { status: 403 }
      );
    }

    // Per-key context limit — cheap check runs before the atomic reservation
    // so oversize requests don't burn a slot on the daily counter.
    if (keyInfo.maxContext && keyInfo.maxContext > 0) {
      const estimatedContext = estimatePromptTokens(body);
      if (estimatedContext > keyInfo.maxContext) {
        return NextResponse.json(
          { error: { message: `Context too long (~${estimatedContext} tokens). This key allows ${keyInfo.maxContext} tokens max.`, type: "context_limit" } },
          { status: 413 }
        );
      }
    }

    // Per-key credit pool sanity (no mutation — deduct_custom_key_credits
    // below does the actual atomic deduction).
    if (keyInfo.customCredits !== null && keyInfo.customCredits <= 0) {
      return NextResponse.json(
        { error: { message: "This key has no credits remaining.", type: "billing_error", credits_available: 0 } },
        { status: 402 }
      );
    }

    // Per-key rolling token window (e.g. 6M tokens / 5h). Cheap trailing-sum
    // read against the dedicated custom_key_token_usage ledger; rejects before
    // consuming a rate-limit slot or touching the upstream. The window is
    // recorded at settlement (record_custom_key_tokens) in both stream paths.
    if (
      keyInfo.tokenWindowLimit &&
      keyInfo.tokenWindowLimit > 0 &&
      keyInfo.tokenWindowSeconds &&
      keyInfo.tokenWindowSeconds > 0
    ) {
      const { data: windowResult, error: windowErr } = await supabase.rpc(
        "check_custom_key_token_window",
        {
          p_key_id: keyInfo.keyId,
          p_window_seconds: keyInfo.tokenWindowSeconds,
          p_token_limit: keyInfo.tokenWindowLimit,
        }
      );
      if (windowErr) {
        return NextResponse.json(
          { error: { message: "Failed to check token limit", type: "server_error" } },
          { status: 500 }
        );
      }
      const win = windowResult as { status: string; used?: number; retry_after_seconds?: number };
      if (win.status === "limited") {
        const retryAfter = Math.max(win.retry_after_seconds ?? 60, 1);
        const windowHours = keyInfo.tokenWindowSeconds / 3600;
        return NextResponse.json(
          {
            error: {
              message: `Token limit reached: ~${win.used ?? keyInfo.tokenWindowLimit} of ${keyInfo.tokenWindowLimit} tokens used in the last ${windowHours}h. Try again in ${retryAfter}s.`,
              type: "rate_limit",
            },
          },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        );
      }
    }

    // Per-key rate limit + daily request limit — atomic reservation RPC so
    // concurrent requests can't all pass the check before the first log is
    // written. Defaults: 60s rate-limit for premium providers, no rate-limit
    // otherwise; daily limit from key config (0 = unlimited).
    const isPremium = isPremiumProviderName(model.provider);
    const rlSeconds = keyInfo.rateLimitSeconds ?? (isPremium ? 60 : 0);
    const dailyReqLimit = keyInfo.dailyRequestLimit ?? 0;

    if (rlSeconds > 0 || dailyReqLimit > 0) {
      const { data: reserveResult, error: reserveErr } = await supabase.rpc("reserve_custom_key_request", {
        p_key_id: keyInfo.keyId,
        p_daily_limit: dailyReqLimit,
        p_rate_limit_seconds: rlSeconds,
      });

      if (reserveErr) {
        return NextResponse.json(
          { error: { message: "Failed to check rate limit", type: "server_error" } },
          { status: 500 }
        );
      }

      const res = reserveResult as { status: string; retry_after_seconds?: number; limit?: number; used?: number };
      if (res.status === "rate_limited") {
        const retryAfter = res.retry_after_seconds ?? 1;
        return NextResponse.json(
          { error: { message: `Rate limit: 1 request per ${rlSeconds}s. Try again in ${retryAfter}s.`, type: "rate_limit" } },
          { status: 429, headers: { "Retry-After": String(Math.max(retryAfter, 1)) } }
        );
      }
      if (res.status === "daily_limit") {
        return NextResponse.json(
          { error: { message: `Daily request limit reached (${dailyReqLimit}/day for this key).`, type: "rate_limit" } },
          { status: 429 }
        );
      }
      customKeyRequestReserved = true;
    }
  } else if (!activeEvent) {
    // 5.5b-normal. Premium plan limits (requests/day + context cap) — applies to trolllm, webproxy, hapuppy, gameron, dlab, riftai.
    // Skipped entirely when an active event covers this model for the user's plan.
    // Zero-cost premium models (free promos) also skip this entire block.
    // PAYG accounts skip it too: they draw no premium pool (so no daily limit
    // or reservation applies) and pay per token instead, which is what lifts
    // the context cap enforced further down this branch.
    if (isPremiumProvider && !isZeroCostPremium && !isPaygRequest) {
      const { data: premiumPlan, error: premiumPlanErr } = await getPlanLimits(
        supabase,
        keyInfo.planId
      );

      // Fail closed on a real lookup failure. Falling through silently here used
      // to degrade EVERY paid plan to the free defaults (15 req/day, 32768 ctx)
      // whenever the deployed code and the DB schema drifted — e.g. selecting a
      // column the production DB didn't have yet. Surfacing a 503 keeps billing
      // correct instead of secretly downgrading paying users.
      if (premiumPlanErr || !premiumPlan) {
        console.error(
          `[premium-gate] plans lookup failed for plan "${keyInfo.planId}": ${premiumPlanErr?.message ?? "no matching plan row"}`
        );
        return NextResponse.json(
          { error: { message: "Plan configuration temporarily unavailable. Please retry shortly.", type: "server_error" } },
          { status: 503 }
        );
      }

      // Plan-level provider allow-list: when set, the plan may only use these
      // premium providers (cheaper tiers gate out the pricier upstreams).
      const planAllowed = premiumPlan?.allowed_providers as string[] | null | undefined;
      if (planAllowed && planAllowed.length > 0 && !planAllowed.includes(model.provider)) {
        return NextResponse.json(
          { error: { message: "Your plan doesn't include this model. Upgrade to access it.", type: "plan_restricted" } },
          { status: 403 }
        );
      }

      const planUnlimited = premiumPlan?.unlimited_providers as string[] | null | undefined;
      isPlanUnlimited = !!planUnlimited && planUnlimited.includes(model.provider);

      if (isPlanUnlimited) {
        // Provider is ~free for this plan: skip the premium pool entirely.
        // Still enforce the plan's context cap + a per-user fair-use guard so a
        // single account can't abuse/resell effectively-free access.
        const gmMaxContext = (premiumPlan?.gm_max_context ?? 32768) * (isContextBoosted ? 2 : 1);
        const estimatedContext = estimatePromptTokens(body);
        if (gmMaxContext > 0 && estimatedContext > gmMaxContext) {
          return NextResponse.json(
            { error: { message: `Context too long (~${estimatedContext} tokens). Your plan allows ${gmMaxContext} tokens max. Upgrade for more.`, type: "context_limit" } },
            { status: 413 }
          );
        }

        const { data: fuResult, error: fuErr } = await supabase.rpc("reserve_fair_use_request", {
          p_user_id: keyInfo.userId,
          p_daily_limit: FAIRUSE_DAILY_CAP,
          p_rate_limit_seconds: FAIRUSE_RATE_LIMIT_SECONDS,
        });
        if (fuErr) {
          return NextResponse.json(
            { error: { message: "Failed to check rate limit", type: "server_error" } },
            { status: 500 }
          );
        }
        const fu = fuResult as { status: string; retry_after_seconds?: number };
        if (fu.status === "rate_limited") {
          const retryAfter = fu.retry_after_seconds ?? 1;
          return NextResponse.json(
            { error: { message: `Rate limit. Try again in ${retryAfter}s.`, type: "rate_limit" } },
            { status: 429, headers: { "Retry-After": String(Math.max(retryAfter, 1)) } }
          );
        }
        if (fu.status === "daily_limit") {
          return NextResponse.json(
            { error: { message: `Daily fair-use limit reached (${FAIRUSE_DAILY_CAP}/day). Resets at UTC midnight.`, type: "rate_limit" } },
            { status: 429 }
          );
        }
        // Reserved on the fair-use counter; refund on upstream failure. Billed
        // as free pool so no credits/premium budget are consumed.
        fairUseReserved = true;
        premiumRequestCostForUsage = 0;
        isFreePool = true;
      } else if (shouldBypassIncludedPremiumRequests(keyInfo)) {
        const availableCredits = getAvailableBillableCredits(keyInfo);
        if (availableCredits < PREMIUM_OVERAGE_COST) {
          return NextResponse.json(
            {
              error: {
                message: `Free included premium requests are paused. Buy credits or upgrade to continue (${PREMIUM_OVERAGE_COST} credits/request).`,
                type: "billing_error",
                credits_required: PREMIUM_OVERAGE_COST,
                credits_available: availableCredits,
              },
            },
            { status: 402 }
          );
        }

        const { data: overageBalance, error: overageErr } = await deductUserCredits(
          supabase,
          keyInfo.userId,
          PREMIUM_OVERAGE_COST,
          true
        );
        if (overageErr || overageBalance === -1) {
          return NextResponse.json(
            {
              error: {
                message: "Failed to charge paid credits for this premium request. Try again.",
                type: "billing_error",
              },
            },
            { status: 402 }
          );
        }

        premiumOveragePurchased = true;
        premiumOverageBalance = overageBalance as number;
        premiumRequestCostForUsage = 0;
        isFreePool = true;

        const { error: overageTxErr } = await supabase.from("transactions").insert({
          user_id: keyInfo.userId,
          amount: -PREMIUM_OVERAGE_COST,
          balance: premiumOverageBalance,
          type: "premium_overage",
          description: `${model.id} - paid premium request (free included usage paused)`,
        });
        if (overageTxErr) {
          console.error("Failed to log paid premium request charge:", overageTxErr.message);
        }
      } else {
      const plan = premiumPlan;

      // Check if user has an active grandfathered override
      const hasActiveOverride =
        keyInfo.gmDailyOverride !== null &&
        keyInfo.gmOverrideExpires &&
        new Date(keyInfo.gmOverrideExpires) > new Date();

      const baseGmDaily = hasActiveOverride
        ? keyInfo.gmDailyOverride!
        : getIncludedPremiumRequestLimit(keyInfo.planId, plan?.gm_daily_requests);

      const referralBonusActive =
        keyInfo.referralBonusExpires !== null &&
        new Date(keyInfo.referralBonusExpires) > new Date();
      const referralBonus = referralBonusActive ? keyInfo.referralBonusRequests : 0;

      const gmDailyRequests = baseGmDaily + referralBonus;
      const gmMaxContext = (plan?.gm_max_context ?? 32768) * (isContextBoosted ? 2 : 1);
      const estimatedContext = estimatePromptTokens(body);

      // Context cap checked BEFORE the atomic reservation so oversize
      // requests don't inflate the daily counter. Applies to all premium
      // providers (t/, an/, w/); free tier only has t/ and w/ access.
      if (gmMaxContext > 0) {
        if (estimatedContext > gmMaxContext) {
          return NextResponse.json(
            { error: { message: `Context too long (~${estimatedContext} tokens). Your plan allows ${gmMaxContext} tokens max. Upgrade for more.`, type: "context_limit" } },
            { status: 413 }
          );
        }
      }

      // Atomic premium reservation: rate limit + daily limit + counter
      // increment in one transaction. Replaces the prior two SELECTs on
      // usage_logs which had a TOCTOU window — concurrent streams could
      // all pass the check before any log was written.
      const basePremiumCost = getContextAdjustedPremiumRequestCost(
        modelId,
        model.provider,
        Number(model.premium_request_cost ?? 1),
        estimatedContext,
        model.context_surcharge_per_10k
      );
      // t/ half-price package: 50k-credit perk halves trolllm premium cost
      // (Opus 6→3, Sonnet 3→1.5) for 30 days. Only applies to trolllm; the
      // expiry lives on profiles.t_discount_expires_at.
      const tDiscountActive =
        model.provider === "trolllm" &&
        !!keyInfo.tDiscountExpires &&
        new Date(keyInfo.tDiscountExpires) > new Date();
      const premiumCost = tDiscountActive ? basePremiumCost * 0.5 : basePremiumCost;
      premiumRequestCostForUsage = premiumCost;
      // TEMP (2026-04-24): upstream is flaky and users may need to retry quickly;
      // disable the 60s/req rate limit until providers stabilize. Daily limits
      // still apply. Revert to `60` to re-enable the per-minute rate limit.
      const { data: reserveResult, error: reserveErr } = await supabase.rpc("reserve_premium_request", {
        p_user_id: keyInfo.userId,
        p_cost: premiumCost,
        p_daily_limit: gmDailyRequests > 0 ? gmDailyRequests : 0,
        p_rate_limit_seconds: 0,
      });

      if (reserveErr) {
        return NextResponse.json(
          { error: { message: "Failed to check rate limit", type: "server_error" } },
          { status: 500 }
        );
      }

      const res = reserveResult as { status: string; retry_after_seconds?: number; limit?: number; used?: number; debt?: number };
      if (res.status === "rate_limited") {
        const retryAfter = res.retry_after_seconds ?? 1;
        return NextResponse.json(
          {
            error: {
              message: `Premium model rate limit: 1 request per minute. Try again in ${retryAfter}s.`,
              type: "rate_limit",
            },
          },
          { status: 429, headers: { "Retry-After": String(Math.max(retryAfter, 1)) } }
        );
      }
      if (res.status === "daily_limit") {
        const debt = Number(res.debt ?? 0);
        if (debt > 0) {
          return NextResponse.json(
            { error: { message: `Premium access locked: you owe ${debt} premium requests for past oversized prompts (>100k tokens beyond your plan's context cap). Contact support to clear the debt.`, type: "rate_limit" } },
            { status: 429 }
          );
        }
        // Offer overage: spend credits for one extra request past the daily cap.
        //
        // The flat PREMIUM_OVERAGE_COST assumes a flat-quota upstream, where one
        // more request costs us ~nothing. That holds for k/, t/, or/, rt/, oc/,
        // bl/, sh/ — and they keep paying exactly 100 credits.
        //
        // It does NOT hold for an upstream that bills us PER TOKEN (marked by
        // context_surcharge_per_10k > 0): there a 32k call on z/claude-sonnet-5
        // costs us $0.0214 while the flat fee collects $0.01, and at a 128k
        // context cap the loss is 5x that. For those models the fee scales with
        // the same context-adjusted premium cost the pool would have charged, so
        // the overage price tracks what the request actually costs us.
        const isPerTokenUpstream = Number(model.context_surcharge_per_10k ?? 0) > 0;
        const overageCost = isPerTokenUpstream
          ? Math.max(Math.ceil(PREMIUM_OVERAGE_COST * premiumCost), PREMIUM_OVERAGE_COST)
          : PREMIUM_OVERAGE_COST;
        const availableCredits = getAvailableBillableCredits(keyInfo);
        if (availableCredits >= overageCost) {
          const { data: overageBalance, error: overageErr } = await supabase.rpc("deduct_credits", {
            p_user_id: keyInfo.userId,
            p_amount: overageCost,
          });
          if (!overageErr && overageBalance !== -1) {
            premiumOveragePurchased = true;
            premiumOverageBalance = overageBalance as number;
            isFreePool = true; // overage flat fee covers the request; skip per-token billing
            // deduct_credits writes no ledger row, and the isFreePool path
            // below skips the usage transaction — so record the overage
            // charge here. Otherwise the user's credits drop with no
            // matching entry in their history (this was bug A).
            const { error: overageTxErr } = await supabase.from("transactions").insert({
              user_id: keyInfo.userId,
              amount: -overageCost,
              balance: premiumOverageBalance,
              type: "premium_overage",
              description: `${model.id} - extra premium request (daily cap reached)`,
            });
            if (overageTxErr) {
              console.error("Failed to log premium overage charge:", overageTxErr.message);
            }
          } else {
            return NextResponse.json(
              { error: { message: `Daily premium limit reached (${gmDailyRequests}/day). You have ${availableCredits} credits but the deduction failed — try again.`, type: "rate_limit" } },
              { status: 429 }
            );
          }
        } else {
          return NextResponse.json(
            { error: { message: `Daily premium limit reached (${gmDailyRequests}/day). One extra request on this model costs ${overageCost} credits (you have ${availableCredits}).`, type: "rate_limit" } },
            { status: 429 }
          );
        }
      }
      if (!premiumOveragePurchased) {
        // Pool reservation succeeded (status "ok"): the premium counter was
        // incremented by `premiumCost`, so it must be refunded on error.
        // (In the overage path the counter was NOT incremented — the 100-credit
        // fee tracked by premiumOveragePurchased covers that request instead.)
        premiumRequestReserved = true;
        premiumReservedCost = premiumCost;
      }
      // Premium requests are paid for entirely by the premium-request pool
      // (or, past the daily cap, by the overage flat fee). There is no
      // per-request credit charge — credits are spent ONLY as overage.
      // Marking the request free-pool here skips the 1-credit reservation
      // below so a user with 0 credits can still spend their premium pool.
      isFreePool = true;
      }
    }
  }

  // 6. Forward to provider (use upstream_model_id for the real provider name)
  // max_tokens was already validated up front (before any reservation).
  const upstreamModel = model.upstream_model_id || modelId;
  const reservedCompletionTokens = Math.min(
    requestedCompletionTokens ?? DEFAULT_STREAM_RESERVATION_COMPLETION_TOKENS,
    MAX_STREAM_RESERVATION_COMPLETION_TOKENS
  );
  const estimatedPrompt = estimatePromptTokens(body);

  // Ensure upstream and reservation math share the same completion ceiling.
  // Reasoning models reject `max_tokens` and require `max_completion_tokens`,
  // so normalize to whichever the upstream accepts and strip the other to
  // avoid sending both.
  const completionTokensParam = isReasoningModel(upstreamModel)
    ? "max_completion_tokens"
    : "max_tokens";
  delete body.max_tokens;
  delete body.max_completion_tokens;
  // Always forward the clamped ceiling so an oversize request (e.g. a client
  // sending its whole context window as max_tokens) is capped instead of
  // rejected upstream. reservedCompletionTokens = min(requested, MAX).
  body[completionTokensParam] = reservedCompletionTokens;

  // Reasoning models reject `tools` + `reasoning_effort` together on
  // /chat/completions ("use /v1/responses instead"). We don't speak the
  // responses API, and OpenCode (or any agent) needs tools — drop
  // reasoning_effort so the call goes through.
  if (
    isReasoningModel(upstreamModel) &&
    Array.isArray(body.tools) &&
    body.tools.length > 0
  ) {
    delete body.reasoning_effort;
  }

  // Promotional pools are disabled unless AETHER_FREE_PROMOS_ENABLED=true.
  // When enabled, they bypass credits and premium-request accounting under
  // their own per-user/global caps. Pools reset at UTC midnight.
  let freePoolName: string | null = null;
  const freePoolReservationTokens = estimatedPrompt + reservedCompletionTokens;

  // trolllm short-circuit: keys are about to expire, draining them is
  // intentional. No quota tracking — flat free for everyone (no credit
  // deduction, no premium-request cost). Skip the daily-pool reservation
  // path entirely.
  if (FREE_PROMOS_ENABLED && !activeEventId && isFreeProviderName(model.provider)) {
    // Free providers (e.g. trolllm) still need a context cap so users
    // can't send unbounded prompts. Enforce the plan's gm_max_context.
    if (!keyInfo.isCustom) {
      const { data: freePlan } = await getPlanLimits(supabase, keyInfo.planId);

      const freeMaxContext = (freePlan?.gm_max_context ?? 32768) * (isContextBoosted ? 2 : 1);
      if (freeMaxContext > 0) {
        const estimatedContext = estimatePromptTokens(body);
        if (estimatedContext > freeMaxContext) {
          return NextResponse.json(
            { error: { message: `Context too long (~${estimatedContext} tokens). Your plan allows ${freeMaxContext} tokens max. Upgrade for more.`, type: "context_limit" } },
            { status: 413 }
          );
        }
      }
    }
    isFreePool = true;
  }

  // Zero-cost premium / flat-rate models route as free (no credits, no
  // premium pool, no flat-rate fee). However, they still need a context
  // cap so free-tier users can't send unbounded prompts through these
  // models. Look up the plan's gm_max_context and enforce it.
  if (!activeEventId && (isZeroCostPremium || isZeroCostFlatRate)) {
    if (!keyInfo.isCustom) {
      // or/ free-unlimited uses fixed caps (32k free / 128k paid) instead of
      // the plan's gm_max_context, so the promo stays isolated to Orbit and
      // doesn't change context limits for other premium models.
      let zeroCostMaxContext: number;
      if (isOrbitFreeUnlimited) {
        zeroCostMaxContext = keyInfo.planId === "free" ? ORBIT_FREE_CONTEXT : ORBIT_PAID_CONTEXT;
      } else if (isZenllmFreeUnlimited) {
        // z/: 32k for free plans, unlimited (0 = no cap) for paid.
        zeroCostMaxContext = keyInfo.planId === "free" ? ZENLLM_FREE_CONTEXT : ZENLLM_PAID_CONTEXT;
      } else {
        const { data: zeroCostPlan } = await getPlanLimits(supabase, keyInfo.planId);
        zeroCostMaxContext = (zeroCostPlan?.gm_max_context ?? 32768) * (isContextBoosted ? 2 : 1);
      }
      if (zeroCostMaxContext > 0) {
        const estimatedContext = estimatePromptTokens(body);
        if (estimatedContext > zeroCostMaxContext) {
          return NextResponse.json(
            { error: { message: `Context too long (~${estimatedContext} tokens). Your plan allows ${zeroCostMaxContext} tokens max. Upgrade for more.`, type: "context_limit" } },
            { status: 413 }
          );
        }
      }
    }
    isFreePool = true;
  }

  if (FREE_PROMOS_ENABLED && !isFreePool && !activeEventId && upstreamModel === "deepseek-v3.2") {
    freePoolName = "deepseek-v3.2";
    const freePoolReservation = await reserveDailyFreePoolAllowance(
      supabase,
      freePoolName,
      keyInfo.userId,
      freePoolReservationTokens
    );

    if (!freePoolReservation.allowed) {
      const globalExhausted = freePoolReservation.poolUsed >= freePoolReservation.poolLimit;
      const userExhausted = freePoolReservation.userUsed >= freePoolReservation.userLimit;

      // Hard caps — 429 when exceeded.
      if (globalExhausted) {
        return NextResponse.json(
          {
            error: {
              message: `Daily global pool exhausted for deepseek-v3.2 (${(freePoolReservation.poolLimit / 1_000_000).toFixed(0)}M tokens/day). Resets at midnight UTC.`,
              type: "rate_limit",
            },
          },
          { status: 429 }
        );
      }

      if (userExhausted) {
        return NextResponse.json(
          {
            error: {
              message: `Daily deepseek-v3.2 token limit reached (${(freePoolReservation.userLimit / 1000).toFixed(0)}k tokens/day per user). Resets at midnight UTC.`,
              type: "rate_limit",
            },
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        {
          error: {
            message: "Daily deepseek-v3.2 free pool is currently unavailable. Try again later.",
            type: "rate_limit",
          },
        },
        { status: 429 }
      );
    }

    isFreePool = true;
  }

  // 5.6. Atomic credit reservation before forwarding to upstream.
  // For both streaming and non-streaming, we reserve credits up-front so
  // the user cannot receive a response they can't pay for.
  let reservation: StreamChargeReservation | null = null;

  if (!keyInfo.isCustom) {
    const availableBillableCredits = getAvailableBillableCredits(keyInfo);
    const noPaidBalanceError = getNoPaidBalanceError(isFreePool, availableBillableCredits, 0);
    if (noPaidBalanceError) {
      return NextResponse.json(noPaidBalanceError.payload, { status: noPaidBalanceError.status });
    }
  }

  if (!isFreePool) {
    const { credits: reservedCreditsRaw } = calculateCredits(
      estimatedPrompt,
      reservedCompletionTokens,
      {
        cost_per_m_input: model.cost_per_m_input,
        cost_per_m_output: model.cost_per_m_output,
        cost_per_m_cache_read: model.cost_per_m_cache_read ?? 0,
        cost_per_m_cache_write: model.cost_per_m_cache_write ?? 0,
        margin: model.margin,
      }
    );
    // PAYG reserves the worst case up front — the prompt we are about to send
    // plus the full completion ceiling — so a user can never stream a response
    // they cannot pay for. The unused part is refunded at settlement.
    const reservedCredits = isFlatPerTokenKey
      ? flatTokenCredits(estimatedPrompt, reservedCompletionTokens, flatRatePerM).credits
      : isPaygRequest
      ? paygCredits(estimatedPrompt, reservedCompletionTokens, model).credits
      : isPremiumProvider ? 1 : isFlatRateProvider ? Number(model.premium_request_cost ?? 0.1) : Math.max(reservedCreditsRaw, 1);

    if (keyInfo.isCustom && keyInfo.customCredits !== null) {
      const { data: keyBalance, error: reserveErr } = await supabase.rpc("deduct_custom_key_credits", {
        p_key_id: keyInfo.keyId,
        p_amount: reservedCredits,
      });

      if (reserveErr) {
        return NextResponse.json(
          { error: { message: "Failed to reserve key credits", type: "billing_error" } },
          { status: 500 }
        );
      }
      if (keyBalance === -1) {
        return NextResponse.json(
          { error: { message: "Insufficient key credits", type: "billing_error", credits_available: keyInfo.customCredits } },
          { status: 402 }
        );
      }

      reservation = {
        reservedCredits,
        balanceAfterReserve: keyBalance as number,
      };
    } else {
      const { data: reserveBalance, error: reserveErr } = await deductUserCredits(
        supabase,
        keyInfo.userId,
        reservedCredits,
        shouldUsePaidOnlyCredits(keyInfo)
      );

      if (reserveErr) {
        return NextResponse.json(
          { error: { message: "Failed to reserve credits", type: "billing_error" } },
          { status: 500 }
        );
      }
      if (reserveBalance === -1) {
        return NextResponse.json(
          { error: { message: "Insufficient credits", type: "billing_error", credits_required: reservedCredits, credits_available: getAvailableBillableCredits(keyInfo) } },
          { status: 402 }
        );
      }

      reservation = {
        reservedCredits,
        balanceAfterReserve: reserveBalance as number,
      };
    }
  }

  // Capture keyInfo as non-null for inner helpers (already validated above).
  const key = keyInfo!;

  // Helper: refund reserved credits AND request-count reservations on
  // error/exception. Each reservation type (credits / premium RPD /
  // custom-key RPD) is independent, so they're refunded separately.
  async function refundReservation() {
    if (reservation && !isFreePool) {
      if (key.isCustom && key.customCredits !== null) {
        const { error: refundErr } = await supabase.rpc("add_custom_key_credits", {
          p_key_id: key.keyId,
          p_amount: reservation.reservedCredits,
        });
        if (refundErr) {
          console.error("Failed to refund reserved custom-key credits:", refundErr.message);
        }
      } else {
        const { error: refundErr } = await supabase.rpc("add_credits", {
          p_user_id: key.userId,
          p_amount: reservation.reservedCredits,
        });
        if (refundErr) {
          console.error("Failed to refund reserved credits:", refundErr.message);
        }
      }
    }

    if (premiumOveragePurchased) {
      const { error: refundErr } = await supabase.rpc("add_credits", {
        p_user_id: key.userId,
        p_amount: PREMIUM_OVERAGE_COST,
      });
      if (refundErr) {
        console.error("Failed to refund premium overage credits:", refundErr.message);
      } else {
        // Mirror the refund in the ledger so the `premium_overage` charge row
        // written at reservation time is offset and the running balance stays
        // consistent. add_credits returns only the permanent balance, so read
        // the combined total for the row's `balance`.
        const { data: prof } = await supabase
          .from("profiles")
          .select("credits, daily_credits")
          .eq("id", key.userId)
          .single();
        const revBalance = prof
          ? Number(prof.credits ?? 0) + Number(prof.daily_credits ?? 0)
          : 0;
        const { error: revTxErr } = await supabase.from("transactions").insert({
          user_id: key.userId,
          amount: PREMIUM_OVERAGE_COST,
          balance: revBalance,
          type: "premium_overage_refund",
          description: `${model.id} - premium overage refunded (request failed)`,
        });
        if (revTxErr) {
          console.error("Failed to log premium overage refund:", revTxErr.message);
        }
      }
      premiumOveragePurchased = false;
    }

    if (premiumRequestReserved && premiumReservedCost > 0) {
      const { error: refundErr } = await supabase.rpc("refund_premium_request", {
        p_user_id: key.userId,
        p_cost: premiumReservedCost,
      });
      if (refundErr) {
        console.error("Failed to refund premium request reservation:", refundErr.message);
      }
      premiumRequestReserved = false;
    }

    if (customKeyRequestReserved) {
      const { error: refundErr } = await supabase.rpc("refund_custom_key_request", {
        p_key_id: key.keyId,
      });
      if (refundErr) {
        console.error("Failed to refund custom-key request reservation:", refundErr.message);
      }
      customKeyRequestReserved = false;
    }

    if (fairUseReserved) {
      const { error: refundErr } = await supabase.rpc("refund_fair_use_request", {
        p_user_id: key.userId,
      });
      if (refundErr) {
        console.error("Failed to refund fair-use request reservation:", refundErr.message);
      }
      fairUseReserved = false;
    }
  }

  // Helper: settle the difference between reservation and actual cost.
  // Returns the final balance and credits actually charged.
  async function settleReservation(
    actualCredits: number
  ): Promise<{ chargedCredits: number; balanceAfter: number; status: "success" | "settlement_failed" }> {
    if (!reservation) {
      return { chargedCredits: 0, balanceAfter: 0, status: "settlement_failed" };
    }

    let chargedCredits = reservation.reservedCredits;
    let balanceAfter = reservation.balanceAfterReserve;
    let billingStatus: "success" | "settlement_failed" = "success";
    const delta = actualCredits - reservation.reservedCredits;

    if (delta > 0) {
      // Need to charge more
      if (key.isCustom && key.customCredits !== null) {
        const { data: kb, error: err } = await supabase.rpc("deduct_custom_key_credits", {
          p_key_id: key.keyId, p_amount: delta,
        });
        if (err || kb === -1) { billingStatus = "settlement_failed"; }
        else { chargedCredits += delta; balanceAfter = kb as number; }
      } else {
        const { data: nb, error: err } = await deductUserCredits(
          supabase,
          key.userId,
          delta,
          shouldUsePaidOnlyCredits(key)
        );
        if (err || nb === -1) { billingStatus = "settlement_failed"; }
        else { chargedCredits += delta; balanceAfter = nb as number; }
      }
    } else if (delta < 0) {
      // Refund excess
      const refundAmount = Math.abs(delta);
      if (key.isCustom && key.customCredits !== null) {
        const { data: kb, error: err } = await supabase.rpc("add_custom_key_credits", {
          p_key_id: key.keyId, p_amount: refundAmount,
        });
        if (err || kb === -1) { billingStatus = "settlement_failed"; }
        else { chargedCredits -= refundAmount; balanceAfter = kb as number; }
      } else {
        const { data: nb, error: err } = await supabase.rpc("add_credits", {
          p_user_id: key.userId, p_amount: refundAmount,
        });
        if (err || nb === -1) { billingStatus = "settlement_failed"; }
        else { chargedCredits -= refundAmount; balanceAfter = nb as number; }
      }
    }

    return { chargedCredits, balanceAfter, status: billingStatus };
  }

  // Record a zero-cost failure row so provider outages are visible in
  // usage_logs (which otherwise only stores successes). Lets us detect a dead
  // provider via `status like 'error_%'` instead of finding out weeks later.
  const logErrorUsage = async (statusLabel: string) => {
    try {
      await supabase.from("usage_logs").insert({
        user_id: keyInfo.userId,
        api_key_id: keyInfo.keyId,
        model_id: modelId,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        credits_charged: 0,
        cost_usd: 0,
        status: statusLabel,
        duration_ms: Date.now() - startTime,
        premium_cost: 0,
        source: keyInfo.source,
        estimated_prompt_tokens: estimatedPrompt,
        finish_reason: null,
      });
    } catch (e) {
      console.error("Failed to write error usage log:", (e as Error).message);
    }
  };

  try {
    // Ask upstream to include usage data in stream chunks (OpenAI-compatible)
    const forwardBody = { ...body, model: upstreamModel, stream };
    if (stream) {
      (forwardBody as Record<string, unknown>).stream_options = { include_usage: true };
    }

    // Lorebook injection is independent of presets: a user can run one, the
    // other, or both. When both are on, the preset assembly places the
    // activated lore entries around its own prompts in a single pass.
    const activeLorebook =
      keyInfo.lorebookEnabled && keyInfo.lorebook?.entries?.length ? keyInfo.lorebook : null;

    if (keyInfo.presetEnabled) {
      // Built-in preset takes precedence over the user's custom JSONB preset.
      // Its prompt content is server-only and never exposed to the client.
      const activePreset = keyInfo.builtinPresetId
        ? getBuiltinPreset(keyInfo.builtinPresetId)
        : keyInfo.preset;
      if (activePreset) {
        applyPreset(forwardBody as Record<string, unknown>, activePreset, activeLorebook);
      } else if (activeLorebook) {
        applyLorebook(forwardBody as Record<string, unknown>, activeLorebook);
      }
    } else if (activeLorebook) {
      applyLorebook(forwardBody as Record<string, unknown>, activeLorebook);
    }

    const providerResponse = await provider.forward(forwardBody as any, req.signal);

    if (!providerResponse.ok) {
      await refundReservation();

      const errorText = await providerResponse.text();
      const status = providerResponse.status;

      // User-friendly messages instead of leaking upstream details
      let userMessage: string;
      if (status === 403 || status === 401) {
        userMessage = "This model is temporarily unavailable. Please try again in a moment.";
      } else if (status === 429) {
        userMessage = "This model is currently rate limited. Please wait a moment and try again.";
      } else if (status >= 500) {
        userMessage = "The model provider is experiencing issues. Please try again later.";
      } else {
        userMessage = `Model request failed (${status}). Please try again.`;
      }

      console.error(`Upstream error ${status}: ${errorText}`);
      await logErrorUsage(`error_${status}`);

      return NextResponse.json(
        {
          error: {
            message: userMessage,
            type: "upstream_error",
          },
        },
        { status: status >= 500 ? 502 : status }
      );
    }

    // 7. Handle streaming
    if (stream) {
      return handleStreamingResponse(
        providerResponse,
        keyInfo,
        model,
        startTime,
        estimatedPrompt,
        isFreePool,
        freePoolName,
        activeEventId,
        reservation,
        refundReservation,
        req.signal,
        premiumOveragePurchased ? PREMIUM_OVERAGE_COST : 0,
        premiumRequestCostForUsage,
        isPlanUnlimited,
        keyInfo.trainingConsent,
        moderation.flagged,
        messages as { role: string; content: unknown }[],
        isPaygRequest
      );
    }

    // 8. Handle non-streaming — response already received, settle the reservation.
    const data = await providerResponse.json() as {
      usage?: UsageLike;
      [key: string]: unknown;
    };

    // Silent-upstream-failure guard: provider returned 200 OK but the body
    // has no usage data AND no completion text. Treat as a provider error so
    // unstable upstreams can't drain credits with empty replies. Refund the
    // full reservation (credits + premium counter) and bubble a 502 up.
    if ((!data.usage || !Number(data.usage.total_tokens)) && !extractCompletionText(data).trim()) {
      await refundReservation();
      await logErrorUsage("error_empty");
      return NextResponse.json(
        {
          error: {
            message: "The model provider returned an empty response. No credits were charged. Please try again.",
            type: "upstream_error",
          },
        },
        { status: 502 }
      );
    }

    let usage: UsageLike = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let cacheTokens = extractCacheTokens(usage, Number(usage.prompt_tokens) || 0);

    // Some providers omit usage on non-stream responses; estimate to avoid zero-charge responses.
    // Also sanity-check: if upstream reports tokens but they're suspiciously
    // lower than what we can measure locally, use the local estimate instead.
    // This prevents abusive upstreams from under-reporting to drain credits.
    const localCompletionEstimate = estimateTokens(extractCompletionText(data));
    const localPromptEstimate = estimatePromptTokens(body);

    if (!usage.total_tokens || usage.total_tokens <= 0) {
      usage = {
        prompt_tokens: localPromptEstimate,
        completion_tokens: localCompletionEstimate,
        total_tokens: localPromptEstimate + localCompletionEstimate,
      };
      cacheTokens = { read: 0, write: 0 };
    } else {
      // Upstream reported usage — trust it, but enforce a floor so a
      // malicious/buggy upstream can't claim 0 completion tokens when we
      // saw real text in the response.
      if (localCompletionEstimate > 0 && (usage.completion_tokens ?? 0) < localCompletionEstimate) {
        usage = {
          ...usage,
          completion_tokens: localCompletionEstimate,
          total_tokens: (usage.prompt_tokens ?? 0) + localCompletionEstimate,
        };
      }
      // Prompt-token sanity floor (mirrors the completion floor above): the
      // billed prompt side can never be smaller than the prompt we actually
      // forwarded. Some upstreams under-report it (notably Orbit's Anthropic
      // bridge in streaming). See floorPromptTokens for the cache-aware math.
      const flooredPrompt = floorPromptTokens(
        usage.prompt_tokens ?? 0,
        cacheTokens.read,
        cacheTokens.write,
        localPromptEstimate
      );
      if (flooredPrompt !== (usage.prompt_tokens ?? 0)) {
        usage = {
          ...usage,
          prompt_tokens: flooredPrompt,
          total_tokens: flooredPrompt + (usage.completion_tokens ?? 0),
        };
      }
    }

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

    const { credits, costUsd } = calculateCredits(
      promptTokens,
      completionTokens,
      {
        cost_per_m_input: model.cost_per_m_input,
        cost_per_m_output: model.cost_per_m_output,
        cost_per_m_cache_read: model.cost_per_m_cache_read ?? 0,
        cost_per_m_cache_write: model.cost_per_m_cache_write ?? 0,
        margin: model.margin,
      },
      cacheTokens
    );

    // Enterprise per-token key: bill all (prompt+completion) tokens at the flat
    // rate; overrides per-request/per-token model pricing.
    // Bill the customer-VISIBLE prompt (our local estimate of their submitted
    // body), NOT the upstream-reported prompt_tokens — or/ (Kiro) injects a
    // ~11.7k-token system prompt the customer never sent and shouldn't pay for.
    const flatSettle = isFlatPerTokenKey ? flatTokenCredits(estimatedPrompt, completionTokens, flatRatePerM) : null;
    // PAYG settles on the same visible-token basis as the enterprise flat rate:
    // our own estimate of the prompt the customer submitted, never the
    // upstream-reported prompt_tokens (premium resellers inflate it with their
    // own injected system prompt — blaze reports ~1.3k for a trivial "2+2").
    const paygSettle = isPaygRequest ? paygCredits(estimatedPrompt, completionTokens, model) : null;
    // Premium-request models (t/, an/, w/) are flat-rate: 1 credit + N premium-request budget.
    // Flat-rate models (op/) charge a fixed per-request fee stored in premium_request_cost.
    const finalCredits = isFreePool ? 0 : flatSettle ? flatSettle.credits : paygSettle ? paygSettle.credits : isPremiumProvider ? 1 : isFlatRateProvider ? Number(model.premium_request_cost ?? 0.1) : Math.max(credits, 1);
    const loggedCostUsd = flatSettle ? flatSettle.costUsd : paygSettle ? paygSettle.costUsd : costUsd;
    // What the request cost US upstream, logged separately because
    // `loggedCostUsd` above is overwritten with the amount CHARGED under PAYG
    // and enterprise flat-rate keys. `costUsd` is priced off the tokens the
    // upstream REPORTED (its own count, inflated or not — that is what it
    // invoices) at the model's current cost_per_m_*, so it stays comparable
    // with the provider's dashboard. Written on every path, free pools and
    // zero-cost promos included: the customer pays nothing there, we still do.
    const upstreamCostUsd = costUsd;

    // 9. Settle credits — adjust reservation to match actual usage
    let chargedCredits = 0;
    let newBalance = 0;
    let billingStatus: "success" | "settlement_failed" = "success";

    if (!isFreePool && reservation) {
      const settlement = await settleReservation(finalCredits);
      chargedCredits = settlement.chargedCredits;
      newBalance = settlement.balanceAfter;
      billingStatus = settlement.status;
    }

    // Enterprise per-token key low-balance early warning (hard-stop is the 402
    // at reservation; this just flags an imminent cut-off so the operator tops up).
    if (isFlatPerTokenKey && billingStatus === "success" && newBalance >= 0 && newBalance < ENTERPRISE_LOW_BALANCE_CREDITS) {
      console.warn(`[enterprise] key ${keyInfo.keyId} low balance: ${newBalance} credits (~${Math.floor((newBalance * 100) / Math.max(flatRatePerM, 0.0001))} tokens) left`);
    }

    // 10. Log usage (always log, even for free-pool — needed for token tracking)
    const durationMs = Date.now() - startTime;
    // Requests served under a free event don't cost premium-request budget.
    // PAYG requests draw no premium pool (they skipped the reservation and paid
    // per token), so they must log 0 — otherwise the fallback below invents a
    // cost the user never spent and the Usage page reports phantom premium
    // requests. The live counter (profiles.premium_requests_today) was always
    // correct; only this log column was wrong.
    const premiumCost = isPremiumProvider && !isPaygRequest && !activeEventId && !isPlanUnlimited && !isFlatPerTokenKey && !isFreePool
      ? (premiumRequestCostForUsage || getContextAdjustedPremiumRequestCost(modelId, model.provider, Number(model.premium_request_cost ?? 1), estimatedPrompt, model.context_surcharge_per_10k))
      : 0;
    // finish_reason of the upstream response — logged to diagnose cut-offs
    // (length = hit max_tokens, content_filter = blocked, stop = natural end).
    const finishReason =
      (data as { choices?: Array<{ finish_reason?: string | null }> })
        .choices?.[0]?.finish_reason ?? null;
    const writeTx = !isFreePool && chargedCredits > 0;
    const settlementSuffix = billingStatus === "success" ? "" : ` [${billingStatus}]`;
    // One round-trip / one commit for the usage log + ledger entry (see the
    // log_usage_and_tx function). Credit settlement already happened above, so
    // a logging failure here is non-fatal — we just record it.
    const { error: usageLogError } = await supabase.rpc("log_usage_and_tx", {
      p_user_id: keyInfo.userId,
      p_api_key_id: keyInfo.keyId,
      p_model_id: modelId,
      p_prompt_tokens: promptTokens,
      p_completion_tokens: completionTokens,
      p_total_tokens: totalTokens,
      p_credits_charged: premiumOveragePurchased ? PREMIUM_OVERAGE_COST : (isFreePool ? 0 : chargedCredits),
      p_cost_usd: loggedCostUsd,
      p_upstream_cost_usd: upstreamCostUsd,
      p_status: isFreePool ? "success" : billingStatus,
      p_duration_ms: durationMs,
      p_premium_cost: premiumCost,
      p_cache_read_tokens: cacheTokens.read,
      p_cache_write_tokens: cacheTokens.write,
      p_source: keyInfo.source,
      p_estimated_prompt_tokens: estimatedPrompt,
      p_finish_reason: finishReason,
      p_tx_amount: writeTx ? -chargedCredits : null,
      p_tx_balance: writeTx ? newBalance : null,
      p_tx_type: writeTx ? (keyInfo.isCustom ? "custom_key_usage" : "usage") : null,
      p_tx_description: writeTx ? `${modelId} - ${totalTokens} tokens${settlementSuffix}` : null,
    });
    if (usageLogError) {
      console.error("Failed to write usage log:", usageLogError.message);
    }

    // Record real token usage against the per-key rolling window (non-fatal).
    if (
      keyInfo.isCustom &&
      keyInfo.keyId &&
      keyInfo.tokenWindowLimit &&
      keyInfo.tokenWindowLimit > 0 &&
      keyInfo.tokenWindowSeconds &&
      keyInfo.tokenWindowSeconds > 0 &&
      totalTokens > 0
    ) {
      const { error: windowRecErr } = await supabase.rpc("record_custom_key_tokens", {
        p_key_id: keyInfo.keyId,
        p_tokens: totalTokens,
        p_window_seconds: keyInfo.tokenWindowSeconds,
      });
      if (windowRecErr) {
        console.error("Failed to record custom key token window:", windowRecErr.message);
      }
    }

    // Premium-request debt accrual DISABLED for free tier (2026-05-24).
    // It was the only path still calling accrue_prompt_cap_debt (paid plans
    // were already exempt). Because debt never resets on day rollover and is
    // counted against the daily cap, the same estimator under-count that got
    // paid plans exempted was permanently locking free users out of their
    // 15/day allowance ("limit never resets"). The pre-flight context check
    // (413 in the premium gate) remains the enforcement mechanism. Do NOT
    // re-enable without making debt decay/reset per day first.

    // (transaction ledger row is written together with the usage log above
    // via log_usage_and_tx)

    // Do not return a successful model response when final settlement failed.
    if (!isFreePool && billingStatus === "settlement_failed") {
      return NextResponse.json(
        {
          error: {
            message: "Billing settlement failed. Request output was not delivered.",
            type: "billing_error",
            code: "settlement_failed",
          },
        },
        { status: 402 }
      );
    }

    try {
      // Increment active free event token pool
      if (activeEventId) {
        await incrementFreeEventTokens(supabase, activeEventId, totalTokens);
      }
    } catch (postAccountingError) {
      console.error("Post-request pool accounting failed:", postAccountingError);
    }

    // Training-data capture (non-streaming). Only for users who consented AND
    // only when the CSAM gate did NOT flag this request — flagged content must
    // never enter the corpus. Best-effort; never blocks the response.
    if (keyInfo.trainingConsent && !moderation.flagged) {
      await captureTrainingSample({
        userId: keyInfo.userId,
        modelId,
        source: keyInfo.source,
        messages: messages as { role: string; content: unknown }[],
        completion: extractCompletionText(data),
        promptTokens,
        completionTokens,
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    await refundReservation();

    return NextResponse.json(
      { error: { message: (error as Error).message, type: "server_error" } },
      { status: 500 }
    );
  }
}

async function handleStreamingResponse(
  providerResponse: Response,
  keyInfo: { userId: string; keyId: string | null; credits: number; dailyCredits: number; isCustom: boolean; customCredits: number | null; planId: string; source: "api" | "chat"; pricingMode?: string; flatCostPerMTokens?: number | null; tokenWindowSeconds?: number | null; tokenWindowLimit?: number | null },
  model: { id: string; provider: string; cost_per_m_input: number; cost_per_m_output: number; cost_per_m_cache_read?: number; cost_per_m_cache_write?: number; margin: number; premium_request_cost?: number; context_surcharge_per_10k?: number | null; payg_credits_per_m_input?: number; payg_credits_per_m_output?: number },
  startTime: number,
  estimatedPromptTokens: number = 0,
  isFreePool: boolean = false,
  freePoolName: string | null = null,
  activeEventId: string | null = null,
  reservation: StreamChargeReservation | null = null,
  refundReservation: () => Promise<void> = async () => {},
  clientSignal?: AbortSignal,
  // >0 when this request was paid for with a premium-overage flat fee. The
  // fee is charged (and ledger-logged) up front in the main handler; passed
  // here only so the usage_log row reflects what was actually charged.
  premiumOverageCharged: number = 0,
  premiumRequestCostForUsage: number = 0,
  // True when served under a plan-"unlimited" provider: log 0 premium cost.
  isPlanUnlimited: boolean = false,
  // Training-data capture: the user consented, the CSAM gate verdict, and the
  // input messages to pair with the streamed completion. Capture is gated on
  // trainingConsent && !moderationFlagged inside finalize().
  trainingConsent: boolean = false,
  moderationFlagged: boolean = false,
  requestMessages: { role: string; content: unknown }[] = [],
  // True when the account is on pay-as-you-go and this premium model is billed
  // per token instead of the flat 1 credit + pool draw. Decided in the main
  // handler (it needs the promo/free-pool context this function doesn't see).
  isPayg: boolean = false,
) {
  const supabase = createAdminClient();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let completionText = "";
  let hasUsageData = false;
  // finish_reason from the last chunk that carries one (length / stop /
  // content_filter) — logged so truncated responses can be diagnosed.
  let finishReason: string | null = null;
  let settled = false; // ensures finalize() runs at most once

  const decoder = new TextDecoder();
  let sseBuffer = "";

  function processSseLine(line: string) {
    if (!line.startsWith("data: ")) return;

    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") return;

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.usage) {
        hasUsageData = true;
        // Use upstream values only when they are positive; a 0 or
        // negative report is treated as "not provided" so the
        // finalize() sanity check can substitute our local estimate.
        const upPrompt = Number(parsed.usage.prompt_tokens);
        const upCompletion = Number(parsed.usage.completion_tokens);
        if (upPrompt > 0) totalPromptTokens = upPrompt;
        if (upCompletion > 0) totalCompletionTokens = upCompletion;
        const streamCache = extractCacheTokens(parsed.usage, Number(parsed.usage.prompt_tokens) || 0);
        if (streamCache.read > 0) cacheReadTokens = streamCache.read;
        if (streamCache.write > 0) cacheWriteTokens = streamCache.write;
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        completionText += delta;
      }
      const chunkFinish = parsed.choices?.[0]?.finish_reason;
      if (typeof chunkFinish === "string" && chunkFinish) {
        finishReason = chunkFinish;
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // --- Final accounting routine, factored out so it can be triggered from
  //     either the natural end of stream OR a client abort (TCP RST / nav-away).
  //     Without this, an attacker could stream a request, abort right before
  //     `flush()` would have run, and walk away having paid only the
  //     under-counted reservation while the upstream charged us full price.
  async function finalize(reason: "complete" | "aborted") {
    if (settled) return;
    settled = true;

    // Client aborted before the upstream stream finished: we never observed
    // real `usage` data, so refund the full reservation rather than charge
    // a guessed amount. The upstream is also aborted (we propagate via the
    // composed AbortController below) so we won't be billed by them either.
    if (reason === "aborted" && !hasUsageData) {
      try { await refundReservation(); } catch (e) {
        console.error("Refund-on-abort failed:", e);
      }
      return;
    }

    // Silent-upstream-failure guard: stream ended cleanly but we never saw
    // a usage payload AND no text was streamed. The provider returned 200 OK
    // and emitted nothing useful — treat as a failure and refund so users
    // don't get billed for empty replies during upstream outages.
    if (reason === "complete" && !hasUsageData && !completionText.trim()) {
      try { await refundReservation(); } catch (e) {
        console.error("Refund-on-empty-stream failed:", e);
      }
      return;
    }

    // If provider didn't send usage data, estimate tokens.
    // Also sanity-check provider-reported values: if the upstream claims
    // fewer completion tokens than what we actually streamed (measured via
    // the real o200k tokenizer on the accumulated text), use the higher of
    // the two. This closes the loophole where an upstream reports
    // completion_tokens: 0 (or absurdly low) while streaming real content.
    if (!hasUsageData) {
      totalPromptTokens = estimatedPromptTokens;
      totalCompletionTokens = estimateTokens(completionText);
    } else {
      // Sanity floor: completion tokens can never be less than what we
      // actually observed being streamed to the client.
      const observedCompletion = completionText ? estimateTokens(completionText) : 0;
      if (observedCompletion > 0 && totalCompletionTokens < observedCompletion) {
        totalCompletionTokens = observedCompletion;
      }
      // Prompt-token sanity floor (mirrors the completion floor above): the
      // billed prompt side can never be smaller than the prompt we actually
      // forwarded. Some upstreams under-report it in streaming — e.g. Orbit's
      // Anthropic bridge emits only the visible-message count in
      // message_start.usage and omits the ~4k system prompt it injects (146 vs
      // ~4300 tokens for the identical request). See floorPromptTokens.
      totalPromptTokens = floorPromptTokens(
        totalPromptTokens,
        cacheReadTokens,
        cacheWriteTokens,
        estimatedPromptTokens
      );
    }

    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const { credits, costUsd } = calculateCredits(
      totalPromptTokens,
      totalCompletionTokens,
      {
        cost_per_m_input: model.cost_per_m_input,
        cost_per_m_output: model.cost_per_m_output,
        cost_per_m_cache_read: model.cost_per_m_cache_read ?? 0,
        cost_per_m_cache_write: model.cost_per_m_cache_write ?? 0,
        margin: model.margin,
      },
      { read: cacheReadTokens, write: cacheWriteTokens }
    );

    const isPremiumModel = isPremiumProviderName(model.provider);
    const isFlatRateModel = isFlatRateProviderName(model.provider);
    // Enterprise per-token key: bill all tokens at the flat rate (see main handler).
    const isFlatPerTokenKey =
      keyInfo.isCustom &&
      keyInfo.pricingMode === "flat_per_token" &&
      (keyInfo.flatCostPerMTokens ?? 0) > 0;
    // Visible-token billing: use the estimated (customer-submitted) prompt, not
    // the upstream count inflated by or/'s injected Kiro system prompt.
    const flatSettle = isFlatPerTokenKey
      ? flatTokenCredits(estimatedPromptTokens, totalCompletionTokens, keyInfo.flatCostPerMTokens ?? 0)
      : null;
    // PAYG bills on the same visible-token basis: our estimate of the submitted
    // prompt (never the inflated upstream count) and the completion total,
    // which already carries the observed-token floor applied above.
    const paygSettle =
      isPayg && !isFreePool
        ? paygCredits(estimatedPromptTokens, totalCompletionTokens, {
            payg_credits_per_m_input: model.payg_credits_per_m_input ?? 0,
            payg_credits_per_m_output: model.payg_credits_per_m_output ?? 0,
          })
        : null;
    const finalCredits = isFreePool ? 0 : flatSettle ? flatSettle.credits : paygSettle ? paygSettle.credits : isPremiumModel ? 1 : isFlatRateModel ? Number(model.premium_request_cost ?? 0.1) : Math.max(credits, 1);
    const loggedCostUsd = flatSettle ? flatSettle.costUsd : paygSettle ? paygSettle.costUsd : costUsd;
    // See the non-streaming settlement: our real upstream cost, kept separate
    // from what the customer was charged.
    const upstreamCostUsd = costUsd;

    let wasCharged = isFreePool;
    let balanceAfter = reservation?.balanceAfterReserve ?? 0;
    let chargedCredits = isFreePool ? 0 : finalCredits;
    let billingStatus: "success" | "billing_failed" | "settlement_failed" = "success";

    if (!isFreePool) {
      if (reservation) {
        wasCharged = true;
        chargedCredits = reservation.reservedCredits;

        const settlementDelta = finalCredits - reservation.reservedCredits;
        if (settlementDelta > 0) {
          if (keyInfo.isCustom && keyInfo.customCredits !== null) {
            const { data: keyBalance, error: settleErr } = await supabase.rpc("deduct_custom_key_credits", {
              p_key_id: keyInfo.keyId,
              p_amount: settlementDelta,
            });
            if (settleErr || keyBalance === -1) {
              // Settlement failed: drain the remaining custom-key balance to
              // zero so the user pays at least everything they had. The user
              // already received the response (we can't recall it).
              billingStatus = "settlement_failed";
              const remaining = (keyInfo.customCredits ?? 0) - reservation.reservedCredits;
              if (remaining > 0 && keyInfo.keyId) {
                const { data: drained } = await supabase.rpc("deduct_custom_key_credits", {
                  p_key_id: keyInfo.keyId,
                  p_amount: remaining,
                });
                if (typeof drained === "number" && drained >= 0) {
                  chargedCredits += remaining;
                  balanceAfter = drained as number;
                }
              }
              // Disable the key — easier than letting it stay usable while in arrears.
              if (keyInfo.keyId) {
                await supabase.from("api_keys").update({ is_active: false, note: "Auto-disabled: settlement_failed" }).eq("id", keyInfo.keyId);
              }
            } else {
              chargedCredits += settlementDelta;
              balanceAfter = keyBalance as number;
            }
          } else {
            const { data: newBalance, error: settleErr } = await deductUserCredits(
              supabase,
              keyInfo.userId,
              settlementDelta,
              shouldUsePaidOnlyCredits(keyInfo)
            );
            if (settleErr || newBalance === -1) {
              // Settlement failed on user balance: drain whatever's left so we
              // don't silently give away the full delta. Then accrue debt as a
              // negative `transactions` row marker for ops to follow up on.
              billingStatus = "settlement_failed";
              const totalAvailable = getAvailableBillableCredits(keyInfo);
              const remaining = totalAvailable - reservation.reservedCredits;
              if (remaining > 0) {
                const { data: drained } = await deductUserCredits(
                  supabase,
                  keyInfo.userId,
                  remaining,
                  shouldUsePaidOnlyCredits(keyInfo)
                );
                if (typeof drained === "number" && drained >= 0) {
                  chargedCredits += remaining;
                  balanceAfter = drained as number;
                }
              }
            } else {
              chargedCredits += settlementDelta;
              balanceAfter = newBalance as number;
            }
          }
        } else if (settlementDelta < 0) {
          const refundAmount = Math.abs(settlementDelta);
          if (keyInfo.isCustom && keyInfo.customCredits !== null) {
            const { data: keyBalance, error: refundErr } = await supabase.rpc("add_custom_key_credits", {
              p_key_id: keyInfo.keyId,
              p_amount: refundAmount,
            });
            if (refundErr || keyBalance === -1) {
              billingStatus = "settlement_failed";
            } else {
              chargedCredits -= refundAmount;
              balanceAfter = keyBalance as number;
            }
          } else {
            const { data: newBalance, error: refundErr } = await supabase.rpc("add_credits", {
              p_user_id: keyInfo.userId,
              p_amount: refundAmount,
            });
            if (refundErr || newBalance === -1) {
              billingStatus = "settlement_failed";
            } else {
              chargedCredits -= refundAmount;
              balanceAfter = newBalance as number;
            }
          }
        }
      } else {
        // No reservation — should not normally happen for paid usage.
        if (keyInfo.isCustom && keyInfo.customCredits !== null) {
          const { data: keyBalance, error: keyErr } = await supabase.rpc("deduct_custom_key_credits", {
            p_key_id: keyInfo.keyId,
            p_amount: finalCredits,
          });
          wasCharged = !keyErr && typeof keyBalance === "number" && keyBalance >= 0;
          balanceAfter = (keyBalance as number) ?? 0;
        } else {
          const { data: newBalance, error: deductError } = await deductUserCredits(
            supabase,
            keyInfo.userId,
            finalCredits,
            shouldUsePaidOnlyCredits(keyInfo)
          );
          wasCharged = !deductError && typeof newBalance === "number" && newBalance >= 0;
          balanceAfter = (newBalance as number) ?? 0;
        }
        if (!wasCharged) {
          billingStatus = "billing_failed";
          chargedCredits = 0;
        }
      }
    }

    // Enterprise per-token key low-balance early warning (see non-stream path).
    if (isFlatPerTokenKey && billingStatus === "success" && balanceAfter >= 0 && balanceAfter < ENTERPRISE_LOW_BALANCE_CREDITS) {
      const rate = keyInfo.flatCostPerMTokens ?? 0;
      console.warn(`[enterprise] key ${keyInfo.keyId} low balance: ${balanceAfter} credits (~${Math.floor((balanceAfter * 100) / Math.max(rate, 0.0001))} tokens) left`);
    }

    const durationMs = Date.now() - startTime;
    const isPremium = isPremiumProviderName(model.provider);
    const streamPremiumCost = isPremium && !isPayg && !activeEventId && !isPlanUnlimited && !isFlatPerTokenKey && !isFreePool
      ? (premiumRequestCostForUsage || getContextAdjustedPremiumRequestCost(model.id, model.provider, Number(model.premium_request_cost ?? 1), estimatedPromptTokens, model.context_surcharge_per_10k))
      : 0;
    const writeStreamTx = !isFreePool && chargedCredits > 0;
    const streamSettlementSuffix = billingStatus === "success" ? "" : ` [${billingStatus}]`;
    // One round-trip / one commit for usage log + ledger entry (see
    // log_usage_and_tx). Settlement already happened above; logging is non-fatal.
    const { error: usageLogError } = await supabase.rpc("log_usage_and_tx", {
      p_user_id: keyInfo.userId,
      p_api_key_id: keyInfo.keyId,
      p_model_id: model.id,
      p_prompt_tokens: totalPromptTokens,
      p_completion_tokens: totalCompletionTokens,
      p_total_tokens: totalTokens,
      p_credits_charged: premiumOverageCharged > 0 ? premiumOverageCharged : chargedCredits,
      p_cost_usd: loggedCostUsd,
      p_upstream_cost_usd: upstreamCostUsd,
      p_status: isFreePool ? "success" : (reason === "aborted" ? "aborted" : billingStatus),
      p_duration_ms: durationMs,
      p_premium_cost: streamPremiumCost,
      p_cache_read_tokens: cacheReadTokens,
      p_cache_write_tokens: cacheWriteTokens,
      p_source: keyInfo.source,
      p_estimated_prompt_tokens: estimatedPromptTokens,
      // "aborted" overrides finish_reason — the client cut the stream, so
      // any upstream finish_reason seen so far is incomplete/misleading.
      p_finish_reason: reason === "aborted" ? "aborted" : finishReason,
      p_tx_amount: writeStreamTx ? -chargedCredits : null,
      p_tx_balance: writeStreamTx ? balanceAfter : null,
      p_tx_type: writeStreamTx ? (keyInfo.isCustom ? "custom_key_usage" : "usage") : null,
      p_tx_description: writeStreamTx
        ? `${model.id} - ${totalTokens} tokens (stream${reason === "aborted" ? ":aborted" : ""})${streamSettlementSuffix}`
        : null,
    });
    if (usageLogError) {
      console.error("Failed to write streaming usage log:", usageLogError.message);
    }

    // Record real token usage against the per-key rolling window (non-fatal).
    // Runs on both clean completion and abort — an aborted stream still
    // consumed upstream tokens that should count toward the window.
    if (
      keyInfo.isCustom &&
      keyInfo.keyId &&
      keyInfo.tokenWindowLimit &&
      keyInfo.tokenWindowLimit > 0 &&
      keyInfo.tokenWindowSeconds &&
      keyInfo.tokenWindowSeconds > 0 &&
      totalTokens > 0
    ) {
      const { error: windowRecErr } = await supabase.rpc("record_custom_key_tokens", {
        p_key_id: keyInfo.keyId,
        p_tokens: totalTokens,
        p_window_seconds: keyInfo.tokenWindowSeconds,
      });
      if (windowRecErr) {
        console.error("Failed to record custom key token window (stream):", windowRecErr.message);
      }
    }

    // Training-data capture (streaming). Only on a cleanly completed stream for
    // consented users whose request the CSAM gate did NOT flag — an aborted
    // stream yields a truncated reply, and flagged content must never be stored.
    if (trainingConsent && !moderationFlagged && reason === "complete") {
      await captureTrainingSample({
        userId: keyInfo.userId,
        modelId: model.id,
        source: keyInfo.source,
        messages: requestMessages,
        completion: completionText,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      });
    }

    // Premium-request debt accrual DISABLED for free tier (2026-05-24).
    // See the non-streaming path above for the full rationale: permanent debt
    // + under-counting estimator was permanently locking free users out of
    // their 15/day. Do NOT re-enable without making debt decay/reset per day.

    // (transaction ledger row is written together with the usage log above
    // via log_usage_and_tx)

    try {
      if (activeEventId) {
        await incrementFreeEventTokens(supabase, activeEventId, totalTokens);
      }
    } catch (postAccountingError) {
      console.error("Post-stream pool accounting failed:", postAccountingError);
    }
  }

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      sseBuffer += decoder.decode(chunk, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = sseBuffer.indexOf("\n")) >= 0) {
        const line = sseBuffer.slice(0, newlineIndex).trim();
        sseBuffer = sseBuffer.slice(newlineIndex + 1);
        processSseLine(line);
      }
    },

    async flush() {
      const trailing = (sseBuffer + decoder.decode()).trim();
      if (trailing) processSseLine(trailing);
      await finalize("complete");
    },
  });

  const body = providerResponse.body;
  if (!body) {
    return NextResponse.json(
      { error: { message: "No response body from provider", type: "server_error" } },
      { status: 502 }
    );
  }

  // Wire client-abort → finalize("aborted") so reservations are refunded
  // (or at least settled with what we observed) when the consumer disconnects.
  // Also propagate the abort to the upstream fetch so we stop being billed.
  if (clientSignal) {
    if (clientSignal.aborted) {
      // Already aborted by the time we got here — refund and bail.
      finalize("aborted").catch((e) => console.error("finalize on already-aborted:", e));
    } else {
      clientSignal.addEventListener(
        "abort",
        () => {
          finalize("aborted").catch((e) => console.error("finalize on abort:", e));
        },
        { once: true }
      );
    }
  }

  body.pipeTo(transformStream.writable).catch((streamPipeError) => {
    console.error("Streaming pipeline failed:", streamPipeError);
    // Pipe failures (upstream RST, etc.) also need finalization so we don't
    // orphan the reservation. Treat as abort if no usage was ever observed.
    finalize(hasUsageData ? "complete" : "aborted").catch((e) =>
      console.error("finalize on pipe failure:", e)
    );
  });

  return new Response(transformStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

type DailyFreePoolReservation = {
  allowed: boolean;
  poolUsed: number;
  poolLimit: number;
  userUsed: number;
  userLimit: number;
};

async function reserveDailyFreePoolAllowance(
  supabase: ReturnType<typeof createAdminClient>,
  poolName: string,
  userId: string,
  tokens: number
) {
  if (tokens <= 0) {
    return {
      allowed: true,
      poolUsed: 0,
      poolLimit: GLOBAL_DAILY_TOKEN_POOL,
      userUsed: 0,
      userLimit: PER_USER_DAILY_TOKEN_LIMIT,
    } satisfies DailyFreePoolReservation;
  }

  const { data, error } = await supabase.rpc("reserve_daily_pool_tokens", {
    p_pool_name: poolName,
    p_user_id: userId,
    p_tokens: tokens,
    p_pool_default_limit: GLOBAL_DAILY_TOKEN_POOL,
    p_user_default_limit: PER_USER_DAILY_TOKEN_LIMIT,
  });

  if (error) {
    throw new Error(`Failed to reserve daily token pool '${poolName}': ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error(`Daily pool reservation '${poolName}' returned empty result`);
  }

  return {
    allowed: Boolean(row.allowed),
    poolUsed: Number(row.pool_used ?? 0),
    poolLimit: Number(row.pool_limit ?? GLOBAL_DAILY_TOKEN_POOL),
    userUsed: Number(row.user_used ?? 0),
    userLimit: Number(row.user_limit ?? PER_USER_DAILY_TOKEN_LIMIT),
  } satisfies DailyFreePoolReservation;
}

async function incrementFreeEventTokens(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
  tokens: number
) {
  if (tokens <= 0) return;

  const { error } = await supabase.rpc("increment_free_event_tokens", {
    p_event_id: eventId,
    p_tokens: tokens,
  });

  if (error) {
    throw new Error(`Failed to increment free event tokens: ${error.message}`);
  }
}
