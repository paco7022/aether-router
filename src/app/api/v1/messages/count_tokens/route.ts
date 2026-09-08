import { NextRequest, NextResponse } from "next/server";
import { estimatePromptTokens } from "@/lib/token-estimator";
import { validateApiKey } from "@/lib/auth";
import { authFailureRetryAfter, recordAuthFailure } from "@/lib/auth-throttle";
import { getClientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

// The tokenizer is CPU-bound and the body is whatever the caller sends, so the
// payload is capped the same way /v1/chat/completions caps its own: by reading
// the stream and aborting past the limit. Content-Length is attacker-controlled
// and can be omitted entirely, so it is not a guard.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readCappedBody(req: NextRequest): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

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

  // The key is actually VALIDATED, not just shape-checked: the header prefix
  // alone left this as an anonymous tokenizer anyone could point load at.
  const clientIp = getClientIp(req.headers);
  const retryAfter = authFailureRetryAfter(clientIp);
  if (retryAfter > 0) {
    return NextResponse.json(
      {
        type: "error",
        error: { type: "rate_limit_error", message: "Too many failed authentication attempts." },
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  if (!(await validateApiKey(auth.slice(7)))) {
    recordAuthFailure(clientIp);
    return NextResponse.json(
      {
        type: "error",
        error: { type: "authentication_error", message: "Invalid API key" },
      },
      { status: 401 }
    );
  }

  const raw = await readCappedBody(req);
  if (raw === null) {
    return NextResponse.json(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: `Request body too large. Max ${MAX_BODY_BYTES / 1024 / 1024} MB.`,
        },
      },
      { status: 413 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
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
