import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { calculateCredits } from "@/lib/credits";
import { getProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  // 6. Forward to provider
  try {
    const providerResponse = await provider.forward(
      { ...body, model: modelId, stream } as any
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
      return handleStreamingResponse(
        providerResponse,
        keyInfo,
        model,
        startTime
      );
    }

    // 8. Handle non-streaming
    const data = await providerResponse.json() as {
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      [key: string]: unknown;
    };

    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const { credits, costUsd } = calculateCredits(
      usage.prompt_tokens,
      usage.completion_tokens,
      {
        cost_per_m_input: model.cost_per_m_input,
        cost_per_m_output: model.cost_per_m_output,
        margin: model.margin,
      }
    );

    // 9. Deduct credits
    const { data: newBalance } = await supabase.rpc("deduct_credits", {
      p_user_id: keyInfo.userId,
      p_amount: credits,
    });

    if (newBalance === -1) {
      return NextResponse.json(
        { error: { message: "Insufficient credits", type: "billing_error", credits_required: credits, credits_available: keyInfo.credits } },
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
      credits_charged: credits,
      cost_usd: costUsd,
      status: "success",
      duration_ms: durationMs,
    });

    await supabase.from("transactions").insert({
      user_id: keyInfo.userId,
      amount: -credits,
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
  startTime: number
) {
  const supabase = createAdminClient();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  const encoder = new TextEncoder();
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
            totalPromptTokens = parsed.usage.prompt_tokens || totalPromptTokens;
            totalCompletionTokens = parsed.usage.completion_tokens || totalCompletionTokens;
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    },

    async flush() {
      // Deduct credits after stream completes
      const totalTokens = totalPromptTokens + totalCompletionTokens;
      if (totalTokens > 0) {
        const { credits, costUsd } = calculateCredits(
          totalPromptTokens,
          totalCompletionTokens,
          {
            cost_per_m_input: model.cost_per_m_input,
            cost_per_m_output: model.cost_per_m_output,
            margin: model.margin,
          }
        );

        const { data: newBalance } = await supabase.rpc("deduct_credits", {
          p_user_id: keyInfo.userId,
          p_amount: credits,
        });

        const durationMs = Date.now() - startTime;
        await supabase.from("usage_logs").insert({
          user_id: keyInfo.userId,
          api_key_id: keyInfo.keyId,
          model_id: model.id,
          prompt_tokens: totalPromptTokens,
          completion_tokens: totalCompletionTokens,
          total_tokens: totalTokens,
          credits_charged: credits,
          cost_usd: costUsd,
          status: "success",
          duration_ms: durationMs,
        });

        if (typeof newBalance === "number" && newBalance >= 0) {
          await supabase.from("transactions").insert({
            user_id: keyInfo.userId,
            amount: -credits,
            balance: newBalance,
            type: "usage",
            description: `${model.id} - ${totalTokens} tokens (stream)`,
          });
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
