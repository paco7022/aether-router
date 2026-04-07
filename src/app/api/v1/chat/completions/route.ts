import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { calculateCredits } from "@/lib/credits";
import { estimateTokens, estimatePromptTokens } from "@/lib/token-estimator";
import { getProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const TEMP_AIRFORCE_ALLOWED_MODELS = new Set(["gemini-3-flash", "deepseek-v3.2", "kimi-k2-0905"]);

function normalizeAirforceModelId(id: string): string {
  return String(id || "").replace(/^a\//, "");
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
      { error: { message: `Provider '${model.provider}' not available`, type: "server_error" } },
      { status: 503 }
    );
  }

  // 5.5a. LightningZeus global pool check (c/ models)
  if (model.provider === "lightningzeus") {
    const today = new Date().toISOString().split("T")[0];

    // Check global pool
    const { data: pool } = await supabase
      .from("lightningzeus_daily_pool")
      .select("used, pool_limit")
      .eq("pool_date", today)
      .maybeSingle();

    const used = pool?.used ?? 0;
    const limit = pool?.pool_limit ?? 3000;

    if (used >= limit) {
      return NextResponse.json(
        { error: { message: `Daily pool exhausted (${limit} requests/day). Try gm/ models instead.`, type: "rate_limit" } },
        { status: 429 }
      );
    }
  }

  // 5.5b. Premium plan limits (requests/day + context cap) — applies to gameron AND lightningzeus
  const isPremiumProvider = model.provider === "gameron" || model.provider === "lightningzeus";
  if (isPremiumProvider) {
    // Block gm/ models for free and basic ($3) tiers — they only get c/ models
    if (model.provider === "gameron" && (keyInfo.planId === "free" || keyInfo.planId === "basic")) {
      return NextResponse.json(
        { error: { message: "Oops, it seems that something has gone wrong, you do not have access to this model, try with c/ or upgrade your plan.", type: "plan_restricted" } },
        { status: 403 }
      );
    }

    // Gameron-only: require daily claim (only for plans that have gm/ access)
    if (model.provider === "gameron") {
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

    // Default to free-tier limits if plan not found (safe fallback)
    const gmDailyRequests = plan?.gm_daily_requests ?? 15;
    const gmMaxContext = plan?.gm_max_context ?? 32768;

    // Check daily request limit (0 = unlimited) — count both gm/ and c/ usage
    if (gmDailyRequests > 0) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { count: gmCount, error: gmErr } = await supabase
        .from("usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", keyInfo.userId)
        .like("model_id", "gm/%")
        .gte("created_at", todayStart.toISOString());

      const { count: cCount, error: cErr } = await supabase
        .from("usage_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", keyInfo.userId)
        .like("model_id", "c/%")
        .gte("created_at", todayStart.toISOString());

      if (gmErr || cErr) {
        return NextResponse.json(
          { error: { message: "Failed to check rate limit", type: "server_error" } },
          { status: 500 }
        );
      }

      const totalPremiumUsed = (gmCount ?? 0) + (cCount ?? 0);
      if (totalPremiumUsed >= gmDailyRequests) {
        return NextResponse.json(
          { error: { message: `Daily premium limit reached (${gmDailyRequests} requests/day for your plan). Upgrade for more.`, type: "rate_limit" } },
          { status: 429 }
        );
      }
    }

    // Check context length limit (0 = unlimited) — only applies to gm/ models, c/ has no context limit
    if (gmMaxContext > 0 && model.provider === "gameron") {
      const estimatedContext = estimatePromptTokens(messages);
      if (estimatedContext > gmMaxContext) {
        return NextResponse.json(
          { error: { message: `Context too long (~${estimatedContext} tokens). Your plan allows ${gmMaxContext} tokens max. Upgrade for more.`, type: "context_limit" } },
          { status: 413 }
        );
      }
    }
  }

  // 5.6. Pre-check credits before forwarding (avoid free requests)
  const totalCredits = keyInfo.credits + keyInfo.dailyCredits;
  if (totalCredits <= 0) {
    return NextResponse.json(
      { error: { message: "Insufficient credits", type: "billing_error", credits_available: totalCredits } },
      { status: 402 }
    );
  }

  // 6. Forward to provider (use upstream_model_id for the real provider name)
  const upstreamModel = model.upstream_model_id || modelId;

  if (model.provider === "airforce") {
    const allowedModel = normalizeAirforceModelId(upstreamModel);
    if (!TEMP_AIRFORCE_ALLOWED_MODELS.has(allowedModel)) {
      return NextResponse.json(
        {
          error: {
            message:
              "Airforce temporary pool only allows: gemini-3-flash, deepseek-v3.2, kimi-k2-0905",
            type: "invalid_request",
          },
        },
        { status: 403 }
      );
    }
  }

  try {
    const providerResponse = await provider.forward(
      { ...body, model: upstreamModel, stream } as any
    );

    if (!providerResponse.ok) {
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

      console.error(`[${model.provider}] Upstream error ${status}: ${errorText}`);

      return NextResponse.json(
        {
          error: {
            message: userMessage,
            type: "upstream_error",
            provider: model.provider,
          },
        },
        { status: status >= 500 ? 502 : status }
      );
    }

    // 7. Handle streaming
    if (stream) {
      const estPrompt = estimatePromptTokens(messages);
      return handleStreamingResponse(
        providerResponse,
        keyInfo,
        model,
        startTime,
        estPrompt
      );
    }

    // 8. Handle non-streaming
    const data = await providerResponse.json() as {
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      [key: string]: unknown;
    };

    let usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Some providers omit usage on non-stream responses; estimate to avoid zero-charge responses.
    if (!usage.total_tokens || usage.total_tokens <= 0) {
      const estimatedPrompt = estimatePromptTokens(messages);
      const estimatedCompletion = estimateTokens(extractCompletionText(data));
      usage = {
        prompt_tokens: estimatedPrompt,
        completion_tokens: estimatedCompletion,
        total_tokens: estimatedPrompt + estimatedCompletion,
      };
    }

    const { credits, costUsd } = calculateCredits(
      usage.prompt_tokens,
      usage.completion_tokens,
      {
        cost_per_m_input: model.cost_per_m_input,
        cost_per_m_output: model.cost_per_m_output,
        margin: model.margin,
      }
    );

    const finalCredits = Math.max(credits, 1);

    // 9. Deduct credits
    const { data: newBalance, error: deductError } = await supabase.rpc("deduct_credits", {
      p_user_id: keyInfo.userId,
      p_amount: finalCredits,
    });

    if (deductError) {
      return NextResponse.json(
        { error: { message: "Failed to deduct credits", type: "billing_error" } },
        { status: 500 }
      );
    }

    if (newBalance === -1) {
      return NextResponse.json(
        { error: { message: "Insufficient credits", type: "billing_error", credits_required: finalCredits, credits_available: keyInfo.credits + keyInfo.dailyCredits } },
        { status: 402 }
      );
    }

    // 10. Log usage
    const durationMs = Date.now() - startTime;
    await supabase.from("usage_logs").insert({
      user_id: keyInfo.userId,
      api_key_id: keyInfo.keyId,
      model_id: modelId,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      credits_charged: finalCredits,
      cost_usd: costUsd,
      status: "success",
      duration_ms: durationMs,
    });

    await supabase.from("transactions").insert({
      user_id: keyInfo.userId,
      amount: -finalCredits,
      balance: newBalance as number,
      type: "usage",
      description: `${modelId} - ${usage.total_tokens} tokens`,
    });

    // Increment lightningzeus global pool counter
    if (model.provider === "lightningzeus") {
      await incrementLightningzeusPool(supabase);
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message, type: "server_error" } },
      { status: 500 }
    );
  }
}

async function handleStreamingResponse(
  providerResponse: Response,
  keyInfo: { userId: string; keyId: string; credits: number },
  model: { id: string; provider: string; cost_per_m_input: number; cost_per_m_output: number; margin: number },
  startTime: number,
  estimatedPromptTokens: number = 0
) {
  const supabase = createAdminClient();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
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

      // Always deduct credits (even if tokens are estimated)
      const totalTokens = totalPromptTokens + totalCompletionTokens;
      const { credits, costUsd } = calculateCredits(
        totalPromptTokens,
        totalCompletionTokens,
        {
          cost_per_m_input: model.cost_per_m_input,
          cost_per_m_output: model.cost_per_m_output,
          margin: model.margin,
        }
      );

      // Minimum 1 credit per request
      const finalCredits = Math.max(credits, 1);

      const { data: newBalance, error: deductError } = await supabase.rpc("deduct_credits", {
        p_user_id: keyInfo.userId,
        p_amount: finalCredits,
      });

      const wasCharged = !deductError && typeof newBalance === "number" && newBalance >= 0;

      const durationMs = Date.now() - startTime;
      await supabase.from("usage_logs").insert({
        user_id: keyInfo.userId,
        api_key_id: keyInfo.keyId,
        model_id: model.id,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalTokens,
        credits_charged: wasCharged ? finalCredits : 0,
        cost_usd: costUsd,
        status: wasCharged ? "success" : "billing_failed",
        duration_ms: durationMs,
      });

      if (wasCharged) {
        await supabase.from("transactions").insert({
          user_id: keyInfo.userId,
          amount: -finalCredits,
          balance: newBalance as number,
          type: "usage",
          description: `${model.id} - ${totalTokens} tokens (stream)`,
        });

        // Increment lightningzeus global pool counter
        if (model.provider === "lightningzeus") {
          await incrementLightningzeusPool(supabase);
        }
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

  body.pipeTo(transformStream.writable).catch(() => {});

  return new Response(transformStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function incrementLightningzeusPool(supabase: ReturnType<typeof createAdminClient>) {
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("lightningzeus_daily_pool")
    .select("used")
    .eq("pool_date", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("lightningzeus_daily_pool")
      .update({ used: existing.used + 1 })
      .eq("pool_date", today);
  } else {
    await supabase
      .from("lightningzeus_daily_pool")
      .insert({ pool_date: today, used: 1, pool_limit: 3000 });
  }
}
