import type { Provider, ProviderRequest } from "./types";
import { guardSseStall, DEFAULT_STREAM_STALL_MS } from "./stream-stall-guard";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Kiro (k/): premium, paid-only EXCLUSIVE provider fronting real Anthropic
// Claude (Opus 4.5–4.7, Sonnet 4–4.6, Haiku 4.5) served from our own Kiro
// Power account via a local kiro-gateway (jwadow/kiro-gateway). The gateway is
// OpenAI-compatible; it auto-refreshes the Kiro/AWS CodeWhisperer token and
// exposes /v1/chat/completions. We reach it through the cloudflared tunnel so
// both the PC and the CF cloud node can use it.
//
// Billing: premium pool — opus = 6 premium_request/call, sonnet = 3 (set per
// model in the DB via premium_request_cost). NOT in any CLAUDE_*_BYPASS set, so
// it stays gated to paid + claude_activated users (exclusive).
//
// KIRO_API_KEY = the gateway's PROXY_API_KEY (our `ksk_` client password).
// KIRO_BASE_URL = the tunnel URL (…/v1); defaults to the local gateway.
function getKiroKey(): string | undefined {
  return (process.env.KIRO_API_KEY || "").trim() || undefined;
}

// Cap dead air on a stalled stream; tune via KIRO_STREAM_STALL_MS.
const STREAM_STALL_MS =
  Number(process.env.KIRO_STREAM_STALL_MS) || DEFAULT_STREAM_STALL_MS;

export const kiroProvider: Provider = {
  name: "kiro",
  baseUrl: process.env.KIRO_BASE_URL || "http://127.0.0.1:8000/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = getKiroKey();
    if (!apiKey) {
      throw new Error("KIRO_API_KEY not configured");
    }

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
        // Guard streaming responses against an upstream stall (gateway/Kiro
        // hiccup) so the client fails fast instead of hanging.
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
