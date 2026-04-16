import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Antigravity provider — forwards to the anti-api instance which manages
 * Google Antigravity accounts internally (account rotation, token refresh, etc.).
 * Uses the same anti-api backend as gemini-cli but routes to antigravity models.
 */
export const antigravityProvider: Provider = {
  name: "antigravity",
  baseUrl: process.env.ANTIGRAVITY_BASE_URL || process.env.GEMINI_CLI_URL || "http://localhost:8964/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.ANTIGRAVITY_API_KEY || process.env.GEMINI_CLI_API_KEY;
    if (!apiKey) {
      throw new Error("ANTIGRAVITY_API_KEY not configured");
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
