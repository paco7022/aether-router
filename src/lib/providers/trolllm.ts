import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// TrollLLM (t/): pay-per-token OpenAI-compatible reseller fronting
// Anthropic, OpenAI, and Google. Upstream already applies prompt caching
// for Anthropic models, so billing reads cache_read/cache_write tokens
// out of the returned usage object (see chat/completions route).
export const trolllmProvider: Provider = {
  name: "trolllm",
  baseUrl: process.env.TROLLLLM_BASE_URL || "https://chat.trollllm.xyz/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.TROLLLLM_API_KEY;
    if (!apiKey) {
      throw new Error("TROLLLLM_API_KEY not configured");
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

      // Pass through success, client errors, and 429 without retry.
      // Only retry transient upstream failures (500/502/504).
      if (res.ok || res.status < 500 || res.status === 503) {
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
