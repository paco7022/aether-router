import { NextRequest, NextResponse } from "next/server";
import { POST as chatCompletionsPOST } from "@/app/api/v1/chat/completions/route";
import {
  anthropicToOpenAIRequest,
  openAIToAnthropicResponse,
  openAIErrorToAnthropic,
  makeOpenAIToAnthropicStreamTransform,
} from "@/lib/anthropic/translate";

export const runtime = "nodejs";
export const maxDuration = 300;

// Anthropic-native Messages endpoint (`POST /v1/messages`).
//
// This is a thin adapter: it translates the Anthropic request into the
// internal OpenAI Chat Completions shape, replays it through the EXISTING
// /api/v1/chat/completions handler in-process (so auth, moderation, routing,
// credit reservation/settlement and logging are reused verbatim — no billing
// logic is duplicated), then translates the OpenAI response back into the
// Anthropic Messages shape (streaming or not).
//
// Lets Anthropic-native clients — Claude Code, the Anthropic SDK, SillyTavern's
// Claude API mode — point straight at api.aether-ai.dev with an Aether key.
// The Aether model id is passed through untouched, so configure the client's
// model to a tools-capable Aether model (e.g. a passthrough Claude provider).

function headersToForward(req: NextRequest): Headers {
  const h = new Headers();
  // Auth + anti-abuse signals the core route reads. Content-Type is set to
  // JSON because we hand it a freshly serialized OpenAI body.
  const pass = [
    "authorization",
    "cookie",
    "x-fingerprint",
    "x-requested-with",
    "x-csrf-token",
    "x-forwarded-for",
    "cf-connecting-ip",
    "x-real-ip",
    "user-agent",
  ];
  for (const name of pass) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  h.set("content-type", "application/json");
  return h;
}

export async function POST(req: NextRequest) {
  // 1. Parse the Anthropic request body.
  let anthBody: Record<string, unknown>;
  try {
    anthBody = await req.json();
  } catch {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "invalid_request_error", message: "Invalid JSON body" },
      },
      { status: 400 }
    );
  }

  const model = String((anthBody as { model?: unknown }).model ?? "");
  const wantStream = (anthBody as { stream?: unknown }).stream === true;

  // 2. Translate Anthropic -> OpenAI and replay through the core handler.
  const openaiBody = anthropicToOpenAIRequest(anthBody);

  const synthetic = new NextRequest(new URL(req.url), {
    method: "POST",
    headers: headersToForward(req),
    body: JSON.stringify(openaiBody),
  });

  let coreResponse: Response;
  try {
    coreResponse = await chatCompletionsPOST(synthetic);
  } catch (e) {
    console.error("[messages] core handler threw:", e);
    return NextResponse.json(
      {
        type: "error",
        error: { type: "api_error", message: "Upstream request failed" },
      },
      { status: 502 }
    );
  }

  const contentType = coreResponse.headers.get("content-type") ?? "";

  // 3a. Error / non-OK -> translate the OpenAI error envelope to Anthropic.
  if (!coreResponse.ok) {
    let errBody: unknown = null;
    try {
      errBody = await coreResponse.json();
    } catch {
      errBody = { error: { message: await coreResponse.text().catch(() => "") } };
    }
    return NextResponse.json(openAIErrorToAnthropic(errBody), {
      status: coreResponse.status,
    });
  }

  // 3b. Streaming -> pipe OpenAI SSE through the Anthropic event transform.
  if (wantStream && contentType.includes("text/event-stream") && coreResponse.body) {
    const transformed = coreResponse.body.pipeThrough(
      makeOpenAIToAnthropicStreamTransform(model)
    );
    return new Response(transformed, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  // 3c. Non-stream -> translate the buffered OpenAI JSON to a Messages object.
  let openaiJson: unknown;
  try {
    openaiJson = await coreResponse.json();
  } catch {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "api_error", message: "Malformed upstream response" },
      },
      { status: 502 }
    );
  }
  return NextResponse.json(openAIToAnthropicResponse(openaiJson, model), {
    status: 200,
  });
}
