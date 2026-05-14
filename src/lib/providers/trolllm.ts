import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// TrollLLM (t/): premium OpenAI-compatible reseller fronting Claude
// at https://chat.trollllm.xyz/v1. Billed as a premium provider (flat
// 1 credit + per-model premium_request_cost). Extra gate:
// profiles.claude_activated must be TRUE for free users (paid users
// are auto-flipped on Stripe checkout).
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

      if (res.ok || res.status < 500 || res.status === 503) {
        return res;
      }

      lastResponse = res;
    }

    return lastResponse!;
  },
};
