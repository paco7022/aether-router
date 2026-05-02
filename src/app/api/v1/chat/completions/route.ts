import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, validateSession } from "@/lib/auth";
import { calculateCredits } from "@/lib/credits";
import { estimateTokens, estimatePromptTokens } from "@/lib/token-estimator";
import { getProvider } from "@/lib/providers";
import {
  isPremiumProvider as isPremiumProviderName,
  isFreeProvider as isFreeProviderName,
  isFlatRateProvider as isFlatRateProviderName,
} from "@/lib/providers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import {
  getCustomKeyNoCreditsError,
  getNoPaidBalanceError,
  isApiKeyAuthHeader,
} from "@/lib/chat-preflight";
import {
  CLAUDE_BLOCK_MESSAGE,
  CLAUDE_PAID_ONLY_MESSAGE,
  claudePaidOnlyApplies,
  isAllowedClaudeProvider,
  isClaudeModel,
} from "@/lib/claude-block";
import {
  CSAM_BLOCK_MESSAGE,
  moderateMessages,
  recordCsamIncidentAndBan,
} from "@/lib/content-moderation";

export const runtime = "nodejs";
// NOTE: If a Vercel function timeout kills a streaming request mid-flight,
// the `flush()` handler and the `catch` block will NOT fire. The
// pre-reserved credits will be stuck as "charged" with no usage log.
// Consider a periodic reconciliation job to detect orphaned reservations.
export const maxDuration = 300;

// Free-pool limits for airforce deepseek-v3.2 (the only remaining
// soft/hard-capped daily pool — nano and op/deepseek-v4-flash promos ended).
const PER_USER_DAILY_TOKEN_LIMIT = 200_000;
const GLOBAL_DAILY_TOKEN_POOL = 10_000_000;
const DEFAULT_STREAM_RESERVATION_COMPLETION_TOKENS = 4096;
const MAX_STREAM_RESERVATION_COMPLETION_TOKENS = 32_768;

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

// OpenAI's reasoning families (gpt-5+, o1/o3/o4) reject `max_tokens` and
// require `max_completion_tokens`. RiftAI's gpt-5.5 hits this directly;
// TrollLLM accepts both, so normalizing here is safe across resellers.
function isReasoningModel(modelId: string): boolean {
  return /^(gpt-[5-9]|o[134])(\b|[-._])/i.test(modelId);
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

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

  // Free-tier API key activation gate.
  //
  // Free users must be flipped to is_activated by an admin (or by paying)
  // before their API keys can route. The chat dashboard (source="chat")
  // is exempt — users can still browse the app, just not use Bearer
  // tokens. Custom keys bypass this entirely; they have their own
  // per-key controls and are only minted by an admin.
  if (
    keyInfo.source === "api" &&
    !keyInfo.isCustom &&
    keyInfo.planId === "free" &&
    !keyInfo.isActivated
  ) {
    return NextResponse.json(
      {
        error: {
          message:
            "This account is not yet activated for API key usage. Message an admin on Discord to request activation.",
          type: "account_not_activated",
        },
      },
      { status: 403 }
    );
  }

  // Extra hardening: if a custom key has exhausted credits, reject before
  // parsing payload or touching upstream selection paths.
  const customKeyNoCreditsError = keyInfo.isCustom
    ? getCustomKeyNoCreditsError(keyInfo.customCredits)
    : null;
  if (customKeyNoCreditsError) {
    return NextResponse.json(customKeyNoCreditsError.payload, { status: customKeyNoCreditsError.status });
  }

  // 3. Parse request body. Reject oversized payloads up-front: a 200-page
  // PDF in base64 is ~2-3MB, anything beyond ~10MB is almost certainly an
  // attempt to push past the context cap with binary content the estimator
  // can't accurately measure.
  //
  // IMPORTANT: The `Content-Length` header is attacker-controlled (can be
  // omitted entirely or lied about with chunked transfer), so we cannot
  // trust it as a guard. We read the body as a byte stream and enforce the
  // cap while accumulating, aborting the moment we exceed it. `req.json()`
  // alone does NOT enforce a size limit in Next.js App Router.
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
  } catch (err) {
    return NextResponse.json(
      { error: { message: "Failed to read request body", type: "invalid_request" } },
      { status: 400 }
    );
  }

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

  // 3.5. CSAM moderation gate — runs before any DB writes, credit
  // reservations, or upstream selection. Only the `sexual/minors` category
  // is enforced; everything else passes through. Fails OPEN on transient
  // OpenAI errors so a moderator outage doesn't take the router down.
  //
  // On a confirmed hit: log to csam_incidents, permanently ban the auth
  // user, disable every API key they own, and return a generic 403 — we
  // do NOT echo the category back to the client.
  const moderation = await moderateMessages(messages as { role: string; content: unknown }[]);
  if (moderation.flagged) {
    await recordCsamIncidentAndBan({
      userId: keyInfo.userId,
      source: keyInfo.source,
      flaggedItems: moderation.flaggedItems,
    });
    return NextResponse.json(
      { error: { message: CSAM_BLOCK_MESSAGE, type: "policy_violation" } },
      { status: 403 }
    );
  }

  // 4. Look up model
  const supabase = createAdminClient();
  const { data: model } = await supabase
    .from("models")
    .select("*")
    .eq("id", modelId)
    .eq("is_active", true)
    .single();

  if (!model) {
    return NextResponse.json(
      { error: { message: "Model not found or unavailable", type: "invalid_request" } },
      { status: 404 }
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
    if (keyInfo.planId === "free" && claudePaidOnlyApplies(model.provider)) {
      return NextResponse.json(
        { error: { message: CLAUDE_PAID_ONLY_MESSAGE, type: "plan_restricted" } },
        { status: 403 }
      );
    }
  }

  const isPremiumProvider = isPremiumProviderName(model.provider);
  const isFlatRateProvider = isFlatRateProviderName(model.provider);
  // Zero-cost premium models (cost_per_m_input=0 + premium_request_cost=0) route
  // as free — no credits or premium-request budget consumed. Revert by restoring
  // cost/margin values in the models table.
  const isZeroCostPremium =
    isPremiumProvider &&
    Number(model.cost_per_m_input) === 0 &&
    Number(model.premium_request_cost) === 0;
  // Same for flat-rate (openrouter): premium_request_cost=0 means free promo.
  // Without this short-circuit we'd call deduct_credits(0), which the RPC
  // rejects with -1 → 402 "Insufficient credits, credits_required: 0".
  const isZeroCostFlatRate =
    isFlatRateProvider &&
    Number(model.premium_request_cost) === 0;

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

  if (!keyInfo.isCustom) {
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
    }
  }

  if (activeEvent) {
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
      // Context cap for this event (cheap, runs after atomic reservation
      // so we don't burn a counter if the request is going to bounce).
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

      isFreePool = true;
      activeEventId = activeEvent.id;
    }
  }

  // Reservation flags so refundReservation() can roll back request counters
  // (premium RPD / custom-key RPD) on upstream failure, independently of the
  // credit reservation.
  let premiumRequestReserved = false;
  let premiumReservedCost = 0;
  let customKeyRequestReserved = false;

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
    if (isPremiumProvider && !isZeroCostPremium) {
      const { data: plan } = await supabase
        .from("plans")
        .select("gm_daily_requests, gm_max_context")
        .eq("id", keyInfo.planId)
        .single();

      // Check if user has an active grandfathered override
      const hasActiveOverride =
        keyInfo.gmDailyOverride !== null &&
        keyInfo.gmOverrideExpires &&
        new Date(keyInfo.gmOverrideExpires) > new Date();

      const baseGmDaily = hasActiveOverride
        ? keyInfo.gmDailyOverride!
        : (plan?.gm_daily_requests ?? 15);

      const referralBonusActive =
        keyInfo.referralBonusExpires !== null &&
        new Date(keyInfo.referralBonusExpires) > new Date();
      const referralBonus = referralBonusActive ? keyInfo.referralBonusRequests : 0;

      const gmDailyRequests = baseGmDaily + referralBonus;
      const gmMaxContext = plan?.gm_max_context ?? 32768;

      // Context cap checked BEFORE the atomic reservation so oversize
      // requests don't inflate the daily counter. Applies to all premium
      // providers (t/, an/, w/); free tier only has t/ and w/ access.
      if (gmMaxContext > 0) {
        const estimatedContext = estimatePromptTokens(body);
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
      const premiumCost = Number(model.premium_request_cost ?? 1);
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
        const message = debt > 0
          ? `Premium access locked: you owe ${debt} premium requests for past oversized prompts (>100k tokens beyond your plan's context cap). Contact support to clear the debt.`
          : `Daily premium limit reached (${gmDailyRequests} requests/day for your plan). Upgrade for more.`;
        return NextResponse.json(
          { error: { message, type: "rate_limit" } },
          { status: 429 }
        );
      }
      premiumRequestReserved = true;
      premiumReservedCost = premiumCost;
    }
  }

  // 6. Forward to provider (use upstream_model_id for the real provider name)
  const upstreamModel = model.upstream_model_id || modelId;
  const requestedCompletionTokens = getRequestedCompletionTokens(body);
  const reservedCompletionTokens = Math.min(
    requestedCompletionTokens ?? DEFAULT_STREAM_RESERVATION_COMPLETION_TOKENS,
    MAX_STREAM_RESERVATION_COMPLETION_TOKENS
  );
  const estimatedPrompt = estimatePromptTokens(body);

  if (requestedCompletionTokens !== null && requestedCompletionTokens > MAX_STREAM_RESERVATION_COMPLETION_TOKENS) {
    return NextResponse.json(
      {
        error: {
          message: `max_tokens too large. Maximum allowed is ${MAX_STREAM_RESERVATION_COMPLETION_TOKENS}.`,
          type: "invalid_request",
        },
      },
      { status: 400 }
    );
  }

  // Ensure upstream and reservation math share the same completion ceiling.
  // Reasoning models reject `max_tokens` and require `max_completion_tokens`,
  // so normalize to whichever the upstream accepts and strip the other to
  // avoid sending both.
  const completionTokensParam = isReasoningModel(upstreamModel)
    ? "max_completion_tokens"
    : "max_tokens";
  delete body.max_tokens;
  delete body.max_completion_tokens;
  body[completionTokensParam] = requestedCompletionTokens ?? reservedCompletionTokens;

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

  // Free pool gating.
  //
  // airforce deepseek-v3.2: fully free forever. Hard-capped at 200k/day per
  //                         user and 10M/day globally — crossing either
  //                         returns 429. Never charges credits.
  // trolllm (t/):           flat-free short-circuit; keys draining. Handled
  //                         just below via isFreeProviderName.
  //
  // Pools reset at UTC midnight.
  let freePoolName: string | null = null;
  const freePoolReservationTokens = estimatedPrompt + reservedCompletionTokens;

  // trolllm short-circuit: keys are about to expire, draining them is
  // intentional. No quota tracking — flat free for everyone (no credit
  // deduction, no premium-request cost). Skip the daily-pool reservation
  // path entirely.
  if (!activeEventId && isFreeProviderName(model.provider)) {
    // Free providers (e.g. trolllm) still need a context cap so users
    // can't send unbounded prompts. Enforce the plan's gm_max_context.
    if (!keyInfo.isCustom) {
      const { data: freePlan } = await supabase
        .from("plans")
        .select("gm_max_context")
        .eq("id", keyInfo.planId)
        .single();

      const freeMaxContext = freePlan?.gm_max_context ?? 32768;
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
      const { data: zeroCostPlan } = await supabase
        .from("plans")
        .select("gm_max_context")
        .eq("id", keyInfo.planId)
        .single();

      const zeroCostMaxContext = zeroCostPlan?.gm_max_context ?? 32768;
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

  if (!isFreePool && !activeEventId && upstreamModel === "deepseek-v3.2") {
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
    const noPaidBalanceError = getNoPaidBalanceError(isFreePool, keyInfo.credits, keyInfo.dailyCredits);
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
    const reservedCredits = isPremiumProvider ? 1 : isFlatRateProvider ? Number(model.premium_request_cost ?? 0.1) : Math.max(reservedCreditsRaw, 1);

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
      const { data: reserveBalance, error: reserveErr } = await supabase.rpc("deduct_credits", {
        p_user_id: keyInfo.userId,
        p_amount: reservedCredits,
      });

      if (reserveErr) {
        return NextResponse.json(
          { error: { message: "Failed to reserve credits", type: "billing_error" } },
          { status: 500 }
        );
      }
      if (reserveBalance === -1) {
        return NextResponse.json(
          { error: { message: "Insufficient credits", type: "billing_error", credits_required: reservedCredits, credits_available: keyInfo.credits + keyInfo.dailyCredits } },
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
        const { data: nb, error: err } = await supabase.rpc("deduct_credits", {
          p_user_id: key.userId, p_amount: delta,
        });
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

  try {
    // Ask upstream to include usage data in stream chunks (OpenAI-compatible)
    const forwardBody = { ...body, model: upstreamModel, stream };
    if (stream) {
      (forwardBody as Record<string, unknown>).stream_options = { include_usage: true };
    }

    // System prompt injection — prepend the user's configured injection before
    // any messages from the client. The injection always goes first so tools
    // like Janitor AI that send their own system prompt still receive ours on top.
    if (keyInfo.systemInjectionEnabled && keyInfo.systemInjection) {
      const msgs = (forwardBody as Record<string, unknown>).messages as Array<{ role: string; content: string }>;
      const sysIdx = msgs.findIndex((m) => m.role === "system");
      if (sysIdx >= 0) {
        msgs[sysIdx] = { ...msgs[sysIdx], content: keyInfo.systemInjection + "\n\n" + msgs[sysIdx].content };
      } else {
        msgs.unshift({ role: "system", content: keyInfo.systemInjection });
      }
    }

    const providerResponse = await provider.forward(forwardBody as any);

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
        req.signal
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
      if ((usage.prompt_tokens ?? 0) <= 0 && localPromptEstimate > 0) {
        usage = {
          ...usage,
          prompt_tokens: localPromptEstimate,
          total_tokens: localPromptEstimate + (usage.completion_tokens ?? 0),
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

    // Premium-request models (t/, an/, w/) are flat-rate: 1 credit + N premium-request budget.
    // Flat-rate models (op/) charge a fixed per-request fee stored in premium_request_cost.
    const finalCredits = isFreePool ? 0 : isPremiumProvider ? 1 : isFlatRateProvider ? Number(model.premium_request_cost ?? 0.1) : Math.max(credits, 1);

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

    // 10. Log usage (always log, even for free-pool — needed for token tracking)
    const durationMs = Date.now() - startTime;
    // Requests served under a free event don't cost premium-request budget.
    const premiumCost = isPremiumProvider && !activeEventId ? Number(model.premium_request_cost ?? 1) : 0;
    const { error: usageLogError } = await supabase.from("usage_logs").insert({
      user_id: keyInfo.userId,
      api_key_id: keyInfo.keyId,
      model_id: modelId,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      cache_read_tokens: cacheTokens.read,
      cache_write_tokens: cacheTokens.write,
      credits_charged: isFreePool ? 0 : chargedCredits,
      cost_usd: costUsd,
      status: isFreePool ? "success" : billingStatus,
      duration_ms: durationMs,
      premium_cost: premiumCost,
      source: keyInfo.source,
      estimated_prompt_tokens: estimatedPrompt,
    });
    if (usageLogError) {
      console.error("Failed to write usage log:", usageLogError.message);
    }

    // Accrue premium-request debt when a prompt sneaks past the pre-flight
    // context estimator and the real prompt_tokens end up over the user's
    // plan cap. Free tier only — paid plans are exempt because the estimator
    // under-counts often enough that paid users were getting hit with debt
    // they didn't deserve.
    if (isPremiumProvider && !isZeroCostPremium && !activeEventId && !keyInfo.isCustom && keyInfo.planId === "free") {
      const { error: debtErr } = await supabase.rpc("accrue_prompt_cap_debt", {
        p_user_id: keyInfo.userId,
        p_plan_id: keyInfo.planId,
        p_actual_tokens: promptTokens,
        p_penalty: 3,
      });
      if (debtErr) console.error("Failed to accrue prompt-cap debt:", debtErr.message);
    }

    if (!isFreePool && chargedCredits > 0) {
      const settlementSuffix = billingStatus === "success" ? "" : ` [${billingStatus}]`;
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: keyInfo.userId,
        amount: -chargedCredits,
        balance: newBalance,
        type: keyInfo.isCustom ? "custom_key_usage" : "usage",
        description: `${modelId} - ${totalTokens} tokens${settlementSuffix}`,
      });
      if (txError) {
        console.error("Failed to write transaction log:", txError.message);
      }
    }

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
  keyInfo: { userId: string; keyId: string | null; credits: number; dailyCredits: number; isCustom: boolean; customCredits: number | null; planId: string; source: "api" | "chat" },
  model: { id: string; provider: string; cost_per_m_input: number; cost_per_m_output: number; cost_per_m_cache_read?: number; cost_per_m_cache_write?: number; margin: number; premium_request_cost?: number },
  startTime: number,
  estimatedPromptTokens: number = 0,
  isFreePool: boolean = false,
  freePoolName: string | null = null,
  activeEventId: string | null = null,
  reservation: StreamChargeReservation | null = null,
  refundReservation: () => Promise<void> = async () => {},
  clientSignal?: AbortSignal,
) {
  const supabase = createAdminClient();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let completionText = "";
  let hasUsageData = false;
  let settled = false; // ensures finalize() runs at most once

  const decoder = new TextDecoder();

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
      // Prompt tokens: upstream said 0 but we know the prompt wasn't empty.
      if (totalPromptTokens <= 0 && estimatedPromptTokens > 0) {
        totalPromptTokens = estimatedPromptTokens;
      }
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
    const finalCredits = isFreePool ? 0 : isPremiumModel ? 1 : isFlatRateModel ? Number(model.premium_request_cost ?? 0.1) : Math.max(credits, 1);

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
            const { data: newBalance, error: settleErr } = await supabase.rpc("deduct_credits", {
              p_user_id: keyInfo.userId,
              p_amount: settlementDelta,
            });
            if (settleErr || newBalance === -1) {
              // Settlement failed on user balance: drain whatever's left so we
              // don't silently give away the full delta. Then accrue debt as a
              // negative `transactions` row marker for ops to follow up on.
              billingStatus = "settlement_failed";
              const totalAvailable = keyInfo.credits + keyInfo.dailyCredits;
              const remaining = totalAvailable - reservation.reservedCredits;
              if (remaining > 0) {
                const { data: drained } = await supabase.rpc("deduct_credits", {
                  p_user_id: keyInfo.userId,
                  p_amount: remaining,
                });
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
          const { data: newBalance, error: deductError } = await supabase.rpc("deduct_credits", {
            p_user_id: keyInfo.userId,
            p_amount: finalCredits,
          });
          wasCharged = !deductError && typeof newBalance === "number" && newBalance >= 0;
          balanceAfter = (newBalance as number) ?? 0;
        }
        if (!wasCharged) {
          billingStatus = "billing_failed";
          chargedCredits = 0;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const isPremium = isPremiumProviderName(model.provider);
    const streamPremiumCost = isPremium && !activeEventId ? Number(model.premium_request_cost ?? 1) : 0;
    const { error: usageLogError } = await supabase.from("usage_logs").insert({
      user_id: keyInfo.userId,
      api_key_id: keyInfo.keyId,
      model_id: model.id,
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_tokens: totalTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
      credits_charged: chargedCredits,
      cost_usd: costUsd,
      status: isFreePool ? "success" : (reason === "aborted" ? "aborted" : billingStatus),
      duration_ms: durationMs,
      premium_cost: streamPremiumCost,
      source: keyInfo.source,
      estimated_prompt_tokens: estimatedPromptTokens,
    });
    if (usageLogError) {
      console.error("Failed to write streaming usage log:", usageLogError.message);
    }

    // See non-streaming path: accrue debt when real prompt_tokens exceed
    // the user's plan cap (estimator under-counted during pre-flight). Free
    // tier only.
    if (isPremium && !activeEventId && !keyInfo.isCustom && keyInfo.planId === "free") {
      const { error: debtErr } = await supabase.rpc("accrue_prompt_cap_debt", {
        p_user_id: keyInfo.userId,
        p_plan_id: keyInfo.planId,
        p_actual_tokens: totalPromptTokens,
        p_penalty: 3,
      });
      if (debtErr) console.error("Failed to accrue prompt-cap debt (stream):", debtErr.message);
    }

    if (!isFreePool && chargedCredits > 0) {
      const settlementSuffix = billingStatus === "success" ? "" : ` [${billingStatus}]`;
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: keyInfo.userId,
        amount: -chargedCredits,
        balance: balanceAfter,
        type: keyInfo.isCustom ? "custom_key_usage" : "usage",
        description: `${model.id} - ${totalTokens} tokens (stream${reason === "aborted" ? ":aborted" : ""})${settlementSuffix}`,
      });
      if (txError) {
        console.error("Failed to write streaming transaction log:", txError.message);
      }
    }

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

      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
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
        } catch {
          // Not valid JSON, skip
        }
      }
    },

    async flush() {
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
