import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// sh00t.host (sh/): premium OpenAI-compatible reseller fronting a mixed catalog
// (Anthropic Claude Opus 4.6–4.8, OpenAI GPT-5.5, Google Gemini 3.x,
// DeepSeek V4, z.ai GLM-5.2, Moonshot Kimi K2.7, MiniMax M-3) via
// https://sh00t.host/v1. Billed as a premium provider — flat 1 credit per
// request + per-model premium_request_cost against the daily premium pool.
//
// GOTCHAS (verified 2026-07-08):
//   - The upstream INFLATES input tokens heavily (injects its own system
//     prompt: ~1.4k prompt_tokens for a trivial "2+2"). Harmless for us since
//     premium-pool billing is per-request via premium_request_cost, not
//     per-token — but do not trust the reported usage for anything.
//   - AGGRESSIVE upstream moderation on Claude: even trivial prompts can come
//     back as {"error":{"type":"agent_router_api_error","code":"content-blocked"}}.
//   - Some upstream sub-accounts can report "Insufficient Balance"
//     (type: upstream_error) per-vendor (e.g. DeepSeek) independent of ours.
//
// ISOLATED KEY: lives in its own env var (SHOOT_API_KEY), never folded into a
// shared pool. Comma-separated pool is supported (pick one at random per
// request); trailing whitespace/newlines are trimmed — PS-set secrets
// sometimes carry \r\n.
function getShootKeys(): string[] {
  return (process.env.SHOOT_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Max time a stream may go with NO real content before we give up.
const STREAM_STALL_MS =
  Number(process.env.SHOOT_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;

export const shootProvider: Provider = {
  name: "shoot",
  baseUrl: process.env.SHOOT_BASE_URL || "https://sh00t.host/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getShootKeys();
    if (keys.length === 0) {
      throw new Error("SHOOT_API_KEY not configured");
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
