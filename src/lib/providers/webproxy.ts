import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Web-subscription proxy (personal experiment). Forwards to a FastAPI instance
// that drives Gemini web subscriptions via Playwright. Not runnable on Vercel —
// the target URL must point to a long-lived server (tunneled RTX box, etc.).
export const webproxyProvider: Provider = {
  name: "webproxy",
  baseUrl: process.env.WEBPROXY_BASE_URL || "http://localhost:8000/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.WEBPROXY_API_KEY;
    if (!apiKey) {
      throw new Error("WEBPROXY_API_KEY not configured");
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

      // Pass through success, client errors, and 429 (capacity) without retry.
      // Only retry transient upstream failures (500/502/504).
      if (res.ok || res.status < 500 || res.status === 503) {
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
