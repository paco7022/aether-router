import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export const gameronProvider: Provider = {
  name: "gameron",
  baseUrl: process.env.GAMERON_BASE_URL || "https://api.gameron.me/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.GAMERON_API_KEY;
    if (!apiKey) {
      throw new Error("GAMERON_API_KEY not configured");
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

      // Retry on 403/429/5xx from upstream, return immediately on success or client errors
      if (res.ok || (res.status >= 400 && res.status < 403) || res.status === 404) {
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
