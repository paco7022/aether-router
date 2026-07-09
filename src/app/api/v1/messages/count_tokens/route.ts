import { NextRequest, NextResponse } from "next/server";
import { estimatePromptTokens } from "@/lib/token-estimator";

export const runtime = "nodejs";

// `POST /v1/messages/count_tokens` — Anthropic's token-counting endpoint.
// Claude Code calls it to size the context window before sending a request.
// This is a local o200k-based estimate (no upstream call, no billing); the
// estimator already understands Anthropic-shaped `system` + `tools`, so the
// request body is passed through as-is. A bearer key must be present to keep
// the endpoint from being an anonymous compute sink, but it is not billed.
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "authentication_error", message: "Missing API key" },
      },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "invalid_request_error", message: "Invalid JSON body" },
      },
      { status: 400 }
    );
  }

  const inputTokens = estimatePromptTokens(body);
  return NextResponse.json({ input_tokens: inputTokens }, { status: 200 });
}
