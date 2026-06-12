import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// rout.my (rt/): premium OpenAI-compatible reseller fronting DeepSeek,
// Google Gemini, xAI Grok, MiniMax, Moonshot, NVIDIA Nemotron, Xiaomi MiMo
// and z.ai GLM via https://api.rout.my/v1.
// Billed as a premium provider — flat 1 credit per request +
// per-model premium_request_cost against the daily premium pool.

// ROUTMY_API_KEY may hold a single key or a comma-separated pool. We pick one
// at random per request to spread load across keys (upstream is rate-limited
// per key, so a pool relieves the "always overloaded" 429s). Trailing
// whitespace/newlines are trimmed — PS-set secrets sometimes carry \r\n.
function getRoutmyKeys(): string[] {
  return (process.env.ROUTMY_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export const routmyProvider: Provider = {
  name: "routmy",
  baseUrl: process.env.ROUTMY_BASE_URL || "https://api.rout.my/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = getRoutmyKeys();
    if (keys.length === 0) {
      throw new Error("ROUTMY_API_KEY not configured");
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
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
