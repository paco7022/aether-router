import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ZenLLM (z/): premium OpenAI-compatible reseller fronting Anthropic Claude
// (Opus 4.5–4.8, Sonnet 4.5–4.6) via https://api.zenllm.org/v1.
// Billed as a premium provider — flat 1 credit per request +
// per-model premium_request_cost against the daily premium pool.
//
// ISOLATED KEY: the upstream key is an ENTERPRISE key SHARED with another
// router, so it lives in its own env var (ZENLLM_API_KEY) and nothing else
// reuses it. Keep it isolated — do not fold it into any shared key pool.
//
// Comma-separated pool is supported (pick one at random per request) in case
// we ever get a second key; today it's typically a single key. Trailing
// whitespace/newlines are trimmed — PS-set secrets sometimes carry \r\n.
function getZenllmKeys(): string[] {
  return (process.env.ZENLLM_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Max time a stream may go with NO real content before we give up. ZenLLM
// pings (": ping") forever when a model is upstream-unavailable (opus-4-8: 503
// non-stream, ping-only on stream), which used to hang SillyTavern in
// "streaming…". Generous default (thinking models are slow to the first
// token); tune via ZENLLM_STREAM_STALL_MS. See guardSseStall for the rest.
const STREAM_STALL_MS =
  Number(process.env.ZENLLM_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;

// Some z/ models reject a tiny completion budget outright rather than clamping
// it: gpt-6-astra answers 400 "Invalid 'max_output_tokens': integer below
// minimum value. Expected a value >= 16" for max_tokens=8. A client asking for
// a very short answer should get a short answer, not an error, so raise an
// explicitly-low budget to the upstream minimum. Requests that set no
// max_tokens are left untouched. Same shape as the dlab floor.
const ZENLLM_MIN_MAX_TOKENS = 16;

export const zenllmProvider: Provider = {
  name: "zenllm",
  baseUrl: process.env.ZENLLM_BASE_URL || "https://api.zenllm.org/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getZenllmKeys();
    if (keys.length === 0) {
      throw new Error("ZENLLM_API_KEY not configured");
    }
    const apiKey = keys[Math.floor(Math.random() * keys.length)];

    const upstreamRequest =
      typeof request.max_tokens === "number" && request.max_tokens < ZENLLM_MIN_MAX_TOKENS
        ? { ...request, max_tokens: ZENLLM_MIN_MAX_TOKENS }
        : request;

    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(upstreamRequest),
        signal,
      });

      if (res.ok || res.status < 500 || res.status === 503) {
        // Guard streaming responses against the ping-only infinite-hang case.
        if (res.ok && request.stream === true && res.body) {
          return new Response(guardSseStall(res.body, STREAM_STALL_MS), {
            status: 200,
            headers: {
              "content-type":
                res.headers.get("content-type") || "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          });
        }
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
