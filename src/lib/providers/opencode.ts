import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// OpenCode Go (oc/): premium OpenAI-compatible reseller at
// https://opencode.ai/zen/go/v1/chat/completions. Fronts GLM, Kimi,
// DeepSeek, MiMo and Qwen. Billed as a premium provider — flat 1 credit
// per request + per-model premium_request_cost against the daily premium
// pool. Same shape as r/, db/, h/, gm/, w/.
//
// Upstream model IDs include the "opencode-go/" prefix
// (e.g. "opencode-go/deepseek-v4-flash"); we store that fully-qualified
// id in models.upstream_model_id and forward it verbatim.
export const opencodeProvider: Provider = {
  name: "opencode",
  baseUrl: process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/go/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.OPENCODE_API_KEY;
    if (!apiKey) {
      throw new Error("OPENCODE_API_KEY not configured");
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
