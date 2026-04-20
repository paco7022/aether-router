import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Hapuppy (h/): pay-per-request OpenAI-compatible reseller fronting
// Claude, Gemini, DeepSeek, GLM, Kimi. Billed as premium: flat 1 credit
// per request + per-model premium_request_cost against the daily pool.
export const hapuppyProvider: Provider = {
  name: "hapuppy",
  baseUrl: process.env.HAPUPPY_BASE_URL || "https://beta.hapuppy.com/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.HAPUPPY_API_KEY;
    if (!apiKey) {
      throw new Error("HAPUPPY_API_KEY not configured");
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
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
