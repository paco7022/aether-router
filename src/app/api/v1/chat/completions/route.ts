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

  // 5.5. Pre-check credits before forwarding (avoid free requests)
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
      return NextResponse.json(
        {
          error: {
            message: `Upstream provider error: ${providerResponse.status}`,
            type: "upstream_error",
            details: errorText,
          },
        },
        { status: providerResponse.status }
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
  model: { id: string; cost_per_m_input: number; cost_per_m_output: number; margin: number },
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
