import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// DeepSeek official API (OpenAI-compatible). Pay-as-you-go, per-token billing.
// Context caching is automatic on DeepSeek's side (prefix-based) and reported
// back via `usage.prompt_tokens_details.cached_tokens`, which the route already
// bills at the model's cache-read rate — no per-request config needed.
export const deepseekProvider: Provider = {
  name: "deepseek",
  baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPSEEK_API_KEY not configured");
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

      if (res.ok || (res.status >= 400 && res.status < 403) || res.status === 404) {
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
