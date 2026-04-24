import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Gameron (gm/): premium OpenAI-compatible reseller fronting Anthropic's
// Claude family with 1M-context variants. Two keys are configured in env
// (PRIMARY + SECONDARY); we start on primary and fall back to secondary on
// auth failure (401/403) so a revoked key doesn't black-hole the provider.
export const gameronProvider: Provider = {
  name: "gameron",
  baseUrl: process.env.GAMERON_BASE_URL || "https://api.gameron.me/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const primaryKey = process.env.GAMERON_PRIMARY_KEY;
    const secondaryKey = process.env.GAMERON_SECONDARY_KEY;

    if (!primaryKey && !secondaryKey) {
      throw new Error("GAMERON_PRIMARY_KEY / GAMERON_SECONDARY_KEY not configured");
    }

    const keys = [primaryKey, secondaryKey].filter((k): k is string => typeof k === "string" && k.length > 0);

    let lastResponse: Response | null = null;

    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const apiKey = keys[keyIdx];

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

        // Auth failure — swap to next key without burning retry budget on the
        // same (broken) key.
        if ((res.status === 401 || res.status === 403) && keyIdx < keys.length - 1) {
          lastResponse = res;
          break;
        }

        // Success, client errors (except the auth swap above), or 429.
        if (res.ok || res.status < 500 || res.status === 503) {
          return res;
        }

        lastResponse = res;
      }
    }

    return lastResponse!;
  },
};
