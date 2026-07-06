import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Atessa (at/): premium OpenAI-compatible reseller at https://atessa.top/v1.
// Fronts real Anthropic Claude (Opus 4.6–4.8, Sonnet 4.6, Haiku 4.5, Fable 5)
// plus OpenAI GPT-5.x and Chinese models (DeepSeek/GLM/Kimi/Minimax). Same
// shape as z/, rt/, or/ — flat 1 credit + per-model premium_request_cost
// against the daily premium pool.
//
// GOTCHA: the upstream WAF returns 403 to non-browser User-Agents (verified:
// python-urllib and default fetch UA are blocked; curl and a browser UA pass).
// We MUST send a browser User-Agent on every request or everything 403s.
//
// GOTCHA: the upstream injects a large (~1.4k token) system prompt of its own
// on top of ours — inflates input token counts (display only; we bill via
// premium_request_cost, not per-token). Mirrors the z/ behaviour.
//
// ISOLATED KEY: lives in its own env var (ATESSA_API_KEY). Comma-separated
// pool supported (random pick per request) if we ever get more than one key.
// Trailing whitespace/newlines are trimmed — PS-set secrets carry \r\n.
function getAtessaKeys(): string[] {
  return (process.env.ATESSA_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const STREAM_STALL_MS =
  Number(process.env.ATESSA_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;

export const atessaProvider: Provider = {
  name: "atessa",
  baseUrl: process.env.ATESSA_BASE_URL || "https://atessa.top/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getAtessaKeys();
    if (keys.length === 0) {
      throw new Error("ATESSA_API_KEY not configured");
    }
    const apiKey = keys[Math.floor(Math.random() * keys.length)];

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
          "User-Agent": BROWSER_UA,
        },
        body: JSON.stringify(request),
        signal,
      });

      if (res.ok || res.status < 500 || res.status === 503) {
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
