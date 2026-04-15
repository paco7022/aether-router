import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { calculateCredits } from "@/lib/credits";
import { estimateTokens, estimatePromptTokens } from "@/lib/token-estimator";
import { getProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

// Free-pool limits shared by nano (na/) and airforce deepseek-v3.2.
const PER_USER_DAILY_TOKEN_LIMIT = 200_000;
const GLOBAL_DAILY_TOKEN_POOL = 10_000_000;
const DEFAULT_STREAM_RESERVATION_COMPLETION_TOKENS = 1024;
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
function extractCacheTokens(usage: UsageLike | undefined): { read: number; write: number } {
  if (!usage) return { read: 0, write: 0 };
  const read =
    Number(usage.cache_read_input_tokens) ||
    Number(usage.prompt_tokens_details?.cached_tokens) ||
    0;
  const write =
    Number(usage.cache_creation_input_tokens) ||
    Number(usage.prompt_tokens_details?.cache_creation_tokens) ||
    0;
  return { read: read > 0 ? read : 0, write: write > 0 ? write : 0 };
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

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // 1. Extract API key
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Missing Authorization header", type: "auth_error" } },
      { status: 401 }
    );
  }
  const apiKey = authHeader.slice(7);

  // 2. Validate API key
  const keyInfo = await validateApiKey(apiKey);
  if (!keyInfo) {
    return NextResponse.json(
      { error: { message: "Invalid API key", type: "auth_error" } },
      { status: 401 }
    );
  }

  // 3. Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
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
      { error: { message: `Model '${modelId}' not found`, type: "invalid_request" } },
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

  const isPremiumProvider =
    model.provider === "trolllm" ||
    model.provider === "antigravity" ||
    model.provider === "webproxy";

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
    } else if (eventRow) {
      activeEvent = eventRow as unknown as FreeEvent;
    }
  }

  if (activeEvent) {
    // Rate limit within event (per user, per prefix)
    if (activeEvent.rate_limit_seconds > 0) {
      const windowAgo = new Date(Date.now() - activeEvent.rate_limit_seconds * 1000).toISOString();
      const { data: recent } = await supabase
        .from("usage_logs")
        .select("created_at")
        .eq("user_id", keyInfo.userId)
        .like("model_id", `${activeEvent.model_prefix}%`)
        .gte("created_at", windowAgo)
        .limit(1)
        .maybeSingle();

      if (recent) {
        const retryAfter = Math.ceil(
          (new Date(recent.created_at).getTime() + activeEvent.rate_limit_seconds * 1000 - Date.now()) / 1000
        );
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
    }

    // Per-user message cap for this event
    if (activeEvent.per_user_msg_limit > 0) {
      const { count } = await supabase
        .from("usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", keyInfo.userId)
        .like("model_id", `${activeEvent.model_prefix}%`)
        .gte("created_at", activeEvent.starts_at);

      if ((count ?? 0) >= activeEvent.per_user_msg_limit) {
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
    }

    // Context cap for this event
    if (activeEvent.max_context > 0) {
      const estimatedContext = estimatePromptTokens(messages);
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

  // 5.5b. Custom key checks — custom keys bypass plan restrictions and use their own limits
  if (keyInfo.isCustom) {
    // Provider allowlist
    if (keyInfo.allowedProviders && !keyInfo.allowedProviders.includes(model.provider)) {
      return NextResponse.json(
        { error: { message: "This key does not have access to this model.", type: "plan_restricted" } },
        { status: 403 }
      );
    }

    // Per-key rate limit (defaults to 60s for premium, no limit for non-premium)
    const isPremium = model.provider === "trolllm" || model.provider === "antigravity" || model.provider === "webproxy";
    const rlSeconds = keyInfo.rateLimitSeconds ?? (isPremium ? 60 : 0);
    if (rlSeconds > 0) {
      const windowAgo = new Date(Date.now() - rlSeconds * 1000).toISOString();
      const { data: recentReq } = await supabase
        .from("usage_logs")
        .select("created_at")
        .eq("api_key_id", keyInfo.keyId)
        .gte("created_at", windowAgo)
        .limit(1)
        .maybeSingle();

      if (recentReq) {
        const retryAfter = Math.ceil(
          (new Date(recentReq.created_at).getTime() + rlSeconds * 1000 - Date.now()) / 1000
        );
        return NextResponse.json(
          { error: { message: `Rate limit: 1 request per ${rlSeconds}s. Try again in ${retryAfter}s.`, type: "rate_limit" } },
          { status: 429, headers: { "Retry-After": String(Math.max(retryAfter, 1)) } }
        );
      }
    }

    // Per-key daily request limit
    if (keyInfo.dailyRequestLimit && keyInfo.dailyRequestLimit > 0) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { count, error: countErr } = await supabase
        .from("usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("api_key_id", keyInfo.keyId)
        .gte("created_at", todayStart.toISOString());

      if (countErr) {
        return NextResponse.json(
          { error: { message: "Failed to check rate limit", type: "server_error" } },
          { status: 500 }
        );
      }
      if ((count ?? 0) >= keyInfo.dailyRequestLimit) {
        return NextResponse.json(
          { error: { message: `Daily request limit reached (${keyInfo.dailyRequestLimit}/day for this key).`, type: "rate_limit" } },
          { status: 429 }
        );
      }
    }

    // Per-key context limit
    if (keyInfo.maxContext && keyInfo.maxContext > 0) {
      const estimatedContext = estimatePromptTokens(messages);
      if (estimatedContext > keyInfo.maxContext) {
        return NextResponse.json(
          { error: { message: `Context too long (~${estimatedContext} tokens). This key allows ${keyInfo.maxContext} tokens max.`, type: "context_limit" } },
          { status: 413 }
        );
      }
    }

    // Per-key credit pool
    if (keyInfo.customCredits !== null) {
      if (keyInfo.customCredits <= 0) {
        return NextResponse.json(
          { error: { message: "This key has no credits remaining.", type: "billing_error", credits_available: 0 } },
          { status: 402 }
        );
      }
    }
  } else if (!activeEvent) {
    // 5.5b-normal. Premium plan limits (requests/day + context cap) — applies to trolllm, antigravity, webproxy.
    // Skipped entirely when an active event covers this model for the user's plan.
    if (isPremiumProvider) {
      // Rate limit: 1 request per minute per user on premium models
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { data: recentPremium } = await supabase
        .from("usage_logs")
        .select("created_at")
        .eq("user_id", keyInfo.userId)
        .or("model_id.like.t/%,model_id.like.an/%,model_id.like.w/%")
        .gte("created_at", oneMinuteAgo)
        .limit(1)
        .maybeSingle();

      if (recentPremium) {
        const retryAfter = Math.ceil(
          (new Date(recentPremium.created_at).getTime() + 60_000 - Date.now()) / 1000
        );
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

      // Block an/ models for free and basic ($3) tiers — they only get t/ and w/ models
      if (model.provider === "antigravity" && (keyInfo.planId === "free" || keyInfo.planId === "basic")) {
        return NextResponse.json(
          { error: { message: "Oops, it seems that something has gone wrong, you do not have access to this model, try with t/ or w/ or upgrade your plan.", type: "plan_restricted" } },
          { status: 403 }
        );
      }

      // Antigravity: require daily claim
      if (model.provider === "antigravity") {
        const today = new Date().toISOString().split("T")[0];
        if (keyInfo.gmClaimedDate !== today) {
          return NextResponse.json(
            { error: { message: "Claim your daily premium requests first at the billing page.", type: "claim_required" } },
            { status: 403 }
          );
        }
      }

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

      const gmDailyRequests = hasActiveOverride
        ? keyInfo.gmDailyOverride!
        : (plan?.gm_daily_requests ?? 15);
      const gmMaxContext = plan?.gm_max_context ?? 32768;

      if (gmDailyRequests > 0) {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const { data: premiumSum, error: premiumErr } = await supabase
          .from("usage_logs")
          .select("premium_cost")
          .eq("user_id", keyInfo.userId)
          .or("model_id.like.t/%,model_id.like.an/%,model_id.like.w/%")
          .gte("created_at", todayStart.toISOString());

        if (premiumErr) {
          return NextResponse.json(
            { error: { message: "Failed to check rate limit", type: "server_error" } },
            { status: 500 }
          );
        }

        const totalPremiumUsed = (premiumSum ?? []).reduce((sum: number, row: { premium_cost: number }) => sum + Number(row.premium_cost), 0);
        if (totalPremiumUsed + Number(model.premium_request_cost ?? 1) > gmDailyRequests) {
          return NextResponse.json(
            { error: { message: `Daily premium limit reached (${gmDailyRequests} requests/day for your plan). Upgrade for more.`, type: "rate_limit" } },
            { status: 429 }
          );
        }
      }

      if (gmMaxContext > 0 && model.provider === "antigravity") {
        const estimatedContext = estimatePromptTokens(messages);
        if (estimatedContext > gmMaxContext) {
          return NextResponse.json(
            { error: { message: `Context too long (~${estimatedContext} tokens). Your plan allows ${gmMaxContext} tokens max. Upgrade for more.`, type: "context_limit" } },
            { status: 413 }
          );
        }
      }
    }
  }

  // 6. Forward to provider (use upstream_model_id for the real provider name)
  const upstreamModel = model.upstream_model_id || modelId;

  // Free pool gating.
  //
  // nano (na/):           first 200k tokens/day per user are free (under a
  //                       10M/day global free pool). Once either cap is hit,
  //                       the request falls through to pay-as-you-go at the
  //                       model's normal rate.
  // airforce deepseek-v3.2: fully free forever. Hard-capped at 200k/day per
  //                       user and 10M/day globally — crossing either returns
  //                       429. Never charges credits.
  //
  // All pools reset at UTC midnight.
  let freePoolName: string | null = null;

  if (!activeEventId && (model.provider === "nano" || upstreamModel === "deepseek-v3.2")) {
    freePoolName = model.provider === "nano" ? "nano" : "deepseek-v3.2";

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const today = todayStart.toISOString().split("T")[0];

    // Global daily pool
    const { data: pool } = await supabase
      .from("daily_token_pools")
      .select("used, pool_limit")
      .eq("pool_name", freePoolName)
      .eq("pool_date", today)
      .maybeSingle();

    const globalLimit = Number(pool?.pool_limit ?? GLOBAL_DAILY_TOKEN_POOL);
    const globalUsed = Number(pool?.used ?? 0);
    const globalExhausted = globalUsed >= globalLimit;

    // Per-user tokens used today against this pool
    let userUsageQuery = supabase
      .from("usage_logs")
      .select("total_tokens")
      .eq("user_id", keyInfo.userId)
      .gte("created_at", todayStart.toISOString());

    userUsageQuery =
      freePoolName === "nano"
        ? userUsageQuery.like("model_id", "na/%")
        : userUsageQuery.eq("model_id", modelId);

    const { data: userUsage } = await userUsageQuery;
    const userTokensUsed = (userUsage || []).reduce(
      (sum, r) => sum + (r.total_tokens || 0),
      0
    );
    const userExhausted = userTokensUsed >= PER_USER_DAILY_TOKEN_LIMIT;

    if (freePoolName === "deepseek-v3.2") {
      // Hard caps — 429 when exceeded.
      if (globalExhausted) {
        return NextResponse.json(
          {
            error: {
              message: `Daily global pool exhausted for deepseek-v3.2 (${(globalLimit / 1_000_000).toFixed(0)}M tokens/day). Resets at midnight UTC.`,
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
              message: `Daily deepseek-v3.2 token limit reached (${(PER_USER_DAILY_TOKEN_LIMIT / 1000).toFixed(0)}k tokens/day per user). Resets at midnight UTC.`,
              type: "rate_limit",
            },
          },
          { status: 429 }
        );
      }
      isFreePool = true;
    } else {
      // nano — soft caps. Free when under both limits, otherwise paid.
      isFreePool = !globalExhausted && !userExhausted;
    }
  }

  // 5.6. Pre-check credits before forwarding (skip for free-pool models)
  if (!isFreePool) {
    if (keyInfo.isCustom && keyInfo.customCredits !== null) {
      // Already checked above
    } else {
      const totalCredits = keyInfo.credits + keyInfo.dailyCredits;
      if (totalCredits <= 0) {
        return NextResponse.json(
          { error: { message: "Insufficient credits", type: "billing_error", credits_available: totalCredits } },
          { status: 402 }
        );
      }
    }
  }

  const streamEstimatedPrompt = stream ? estimatePromptTokens(messages) : 0;
  let streamReservation: StreamChargeReservation | null = null;

  try {
    // Ask upstream to include usage data in stream chunks (OpenAI-compatible)
    const forwardBody = { ...body, model: upstreamModel, stream };
    if (stream) {
      (forwardBody as Record<string, unknown>).stream_options = { include_usage: true };
    }

    // Reserve a minimum charge before opening a non-free stream so we never
    // send streamed content when billing cannot settle at all.
    if (stream && !isFreePool) {
      const requestedCompletionTokens = getRequestedCompletionTokens(body);
      const reservedCompletionTokens = Math.min(
        requestedCompletionTokens ?? DEFAULT_STREAM_RESERVATION_COMPLETION_TOKENS,
        MAX_STREAM_RESERVATION_COMPLETION_TOKENS
      );
      const { credits: reservedCreditsRaw } = calculateCredits(
        streamEstimatedPrompt,
        reservedCompletionTokens,
        {
          cost_per_m_input: model.cost_per_m_input,
          cost_per_m_output: model.cost_per_m_output,
          cost_per_m_cache_read: model.cost_per_m_cache_read ?? 0,
          cost_per_m_cache_write: model.cost_per_m_cache_write ?? 0,
          margin: model.margin,
        }
      );
      const reservedCredits = Math.max(reservedCreditsRaw, 1);

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

        streamReservation = {
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

        streamReservation = {
          reservedCredits,
          balanceAfterReserve: reserveBalance as number,
        };
      }
    }

    const providerResponse = await provider.forward(forwardBody as any);

    if (!providerResponse.ok) {
      if (streamReservation && !isFreePool) {
        if (keyInfo.isCustom && keyInfo.customCredits !== null) {
          const { error: refundErr } = await supabase.rpc("add_custom_key_credits", {
            p_key_id: keyInfo.keyId,
            p_amount: streamReservation.reservedCredits,
          });
          if (refundErr) {
            console.error("Failed to refund reserved custom-key credits after upstream error:", refundErr.message);
          }
        } else {
          const { error: refundErr } = await supabase.rpc("add_credits", {
            p_user_id: keyInfo.userId,
            p_amount: streamReservation.reservedCredits,
          });
          if (refundErr) {
            console.error("Failed to refund reserved credits after upstream error:", refundErr.message);
          }
        }
      }

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
        streamEstimatedPrompt,
        isFreePool,
        freePoolName,
        activeEventId,
        streamReservation
      );
    }

    // 8. Handle non-streaming
    const data = await providerResponse.json() as {
      usage?: UsageLike;
      [key: string]: unknown;
    };

    let usage: UsageLike = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let cacheTokens = extractCacheTokens(usage);

    // Some providers omit usage on non-stream responses; estimate to avoid zero-charge responses.
    if (!usage.total_tokens || usage.total_tokens <= 0) {
      const estimatedPrompt = estimatePromptTokens(messages);
      const estimatedCompletion = estimateTokens(extractCompletionText(data));
      usage = {
        prompt_tokens: estimatedPrompt,
        completion_tokens: estimatedCompletion,
        total_tokens: estimatedPrompt + estimatedCompletion,
      };
      cacheTokens = { read: 0, write: 0 };
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

    const finalCredits = isFreePool ? 0 : Math.max(credits, 1);

    // 9. Deduct credits (skip for free-pool models)
    let newBalance = 0;
    if (!isFreePool) {
      if (keyInfo.isCustom && keyInfo.customCredits !== null) {
        // Deduct from key's own credit pool atomically.
        const { data: keyBalance, error: keyErr } = await supabase.rpc("deduct_custom_key_credits", {
          p_key_id: keyInfo.keyId,
          p_amount: finalCredits,
        });

        if (keyErr) {
          return NextResponse.json(
            { error: { message: "Failed to deduct key credits", type: "billing_error" } },
            { status: 500 }
          );
        }

        if (keyBalance === -1) {
          return NextResponse.json(
            { error: { message: "Insufficient key credits", type: "billing_error", credits_available: keyInfo.customCredits } },
            { status: 402 }
          );
        }
        newBalance = keyBalance as number;
      } else {
        // Deduct from user's credit pool
        const { data: rpcBalance, error: deductError } = await supabase.rpc("deduct_credits", {
          p_user_id: keyInfo.userId,
          p_amount: finalCredits,
        });

        if (deductError) {
          return NextResponse.json(
            { error: { message: "Failed to deduct credits", type: "billing_error" } },
            { status: 500 }
          );
        }

        if (rpcBalance === -1) {
          return NextResponse.json(
            { error: { message: "Insufficient credits", type: "billing_error", credits_required: finalCredits, credits_available: keyInfo.credits + keyInfo.dailyCredits } },
            { status: 402 }
          );
        }
        newBalance = rpcBalance as number;
      }
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
      credits_charged: finalCredits,
      cost_usd: costUsd,
      status: "success",
      duration_ms: durationMs,
      premium_cost: premiumCost,
    });
    if (usageLogError) {
      console.error("Failed to write usage log:", usageLogError.message);
    }

    if (!isFreePool) {
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: keyInfo.userId,
        amount: -finalCredits,
        balance: newBalance,
        type: keyInfo.isCustom ? "custom_key_usage" : "usage",
        description: `${modelId} - ${totalTokens} tokens`,
      });
      if (txError) {
        console.error("Failed to write transaction log:", txError.message);
      }
    }

    try {
      // Increment daily token pool only when the request was actually free.
      // Paid nano requests (after a user crosses their 200k free threshold)
      // shouldn't eat into the global free pool.
      if (freePoolName && isFreePool) {
        await incrementDailyTokenPool(supabase, freePoolName, totalTokens);
      }

      // Increment active free event token pool
      if (activeEventId) {
        await incrementFreeEventTokens(supabase, activeEventId, totalTokens);
      }
    } catch (postAccountingError) {
      console.error("Post-request pool accounting failed:", postAccountingError);
    }

    return NextResponse.json(data);
  } catch (error) {
    if (streamReservation && !isFreePool) {
      if (keyInfo.isCustom && keyInfo.customCredits !== null) {
        const { error: refundErr } = await supabase.rpc("add_custom_key_credits", {
          p_key_id: keyInfo.keyId,
          p_amount: streamReservation.reservedCredits,
        });
        if (refundErr) {
          console.error("Failed to refund reserved custom-key credits after exception:", refundErr.message);
        }
      } else {
        const { error: refundErr } = await supabase.rpc("add_credits", {
          p_user_id: keyInfo.userId,
          p_amount: streamReservation.reservedCredits,
        });
        if (refundErr) {
          console.error("Failed to refund reserved credits after exception:", refundErr.message);
        }
      }
    }

    return NextResponse.json(
      { error: { message: (error as Error).message, type: "server_error" } },
      { status: 500 }
    );
  }
}

async function handleStreamingResponse(
  providerResponse: Response,
  keyInfo: { userId: string; keyId: string; credits: number; isCustom: boolean; customCredits: number | null },
  model: { id: string; provider: string; cost_per_m_input: number; cost_per_m_output: number; cost_per_m_cache_read?: number; cost_per_m_cache_write?: number; margin: number; premium_request_cost?: number },
  startTime: number,
  estimatedPromptTokens: number = 0,
  isFreePool: boolean = false,
  freePoolName: string | null = null,
  activeEventId: string | null = null,
  reservation: StreamChargeReservation | null = null
) {
  const supabase = createAdminClient();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let completionText = "";
  let hasUsageData = false;

  const decoder = new TextDecoder();

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      // Try to parse usage from streamed chunks
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.usage) {
            hasUsageData = true;
            totalPromptTokens = parsed.usage.prompt_tokens ?? totalPromptTokens;
            totalCompletionTokens = parsed.usage.completion_tokens ?? totalCompletionTokens;
            const streamCache = extractCacheTokens(parsed.usage);
            if (streamCache.read > 0) cacheReadTokens = streamCache.read;
            if (streamCache.write > 0) cacheWriteTokens = streamCache.write;
          }
          // Accumulate completion text for fallback estimation
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
      // If provider didn't send usage data, estimate tokens
      if (!hasUsageData) {
        totalPromptTokens = estimatedPromptTokens;
        totalCompletionTokens = estimateTokens(completionText);
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

      const finalCredits = isFreePool ? 0 : Math.max(credits, 1);

      let wasCharged = isFreePool; // free pool is always "success" for logging
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
                billingStatus = "settlement_failed";
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
                billingStatus = "settlement_failed";
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
      const isPremium = model.provider === "trolllm" || model.provider === "antigravity" || model.provider === "webproxy";
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
        status: isFreePool ? "success" : billingStatus,
        duration_ms: durationMs,
        premium_cost: streamPremiumCost,
      });
      if (usageLogError) {
        console.error("Failed to write streaming usage log:", usageLogError.message);
      }

      if (!isFreePool && chargedCredits > 0) {
        const settlementSuffix = billingStatus === "success" ? "" : ` [${billingStatus}]`;
        const { error: txError } = await supabase.from("transactions").insert({
          user_id: keyInfo.userId,
          amount: -chargedCredits,
          balance: balanceAfter,
          type: keyInfo.isCustom ? "custom_key_usage" : "usage",
          description: `${model.id} - ${totalTokens} tokens (stream)${settlementSuffix}`,
        });
        if (txError) {
          console.error("Failed to write streaming transaction log:", txError.message);
        }
      }

      try {
        // Increment daily token pool only for requests that were actually free.
        if (freePoolName && isFreePool) {
          await incrementDailyTokenPool(supabase, freePoolName, totalTokens);
        }

        // Increment active free event token pool
        if (activeEventId) {
          await incrementFreeEventTokens(supabase, activeEventId, totalTokens);
        }
      } catch (postAccountingError) {
        console.error("Post-stream pool accounting failed:", postAccountingError);
      }
    },
  });

  const body = providerResponse.body;
  if (!body) {
    return NextResponse.json(
      { error: { message: "No response body from provider", type: "server_error" } },
      { status: 502 }
    );
  }

  body.pipeTo(transformStream.writable).catch((streamPipeError) => {
    console.error("Streaming pipeline failed:", streamPipeError);
  });

  return new Response(transformStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function incrementDailyTokenPool(
  supabase: ReturnType<typeof createAdminClient>,
  poolName: string,
  tokens: number
) {
  if (tokens <= 0) return;
  const { error } = await supabase.rpc("increment_daily_token_pool", {
    p_pool_name: poolName,
    p_tokens: tokens,
    p_default_limit: GLOBAL_DAILY_TOKEN_POOL,
  });

  if (error) {
    throw new Error(`Failed to increment daily token pool '${poolName}': ${error.message}`);
  }
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
