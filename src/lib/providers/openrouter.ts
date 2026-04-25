import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export const openrouterProvider: Provider = {
  name: "openrouter",
  baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY not configured");
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
          "HTTP-Referer": "https://aether-router.vercel.app",
          "X-Title": "Aether Router",
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
