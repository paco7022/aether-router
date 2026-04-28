import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// RiftAI (r/): premium OpenAI-compatible reseller fronting Anthropic,
// OpenAI, Google, DeepSeek and Moonshot via https://riftai.su/v1.
// Billed as a premium provider — flat 1 credit per request +
// per-model premium_request_cost against the daily premium pool.
export const riftaiProvider: Provider = {
  name: "riftai",
  baseUrl: process.env.RIFTAI_BASE_URL || "https://riftai.su/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.RIFTAI_API_KEY;
    if (!apiKey) {
      throw new Error("RIFTAI_API_KEY not configured");
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
