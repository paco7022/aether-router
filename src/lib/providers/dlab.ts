import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// DLab (db/): premium OpenAI-compatible reseller fronting Anthropic's
// Claude family at https://api.dlabkeys.com/v1. Billed as a premium
// provider (flat 1 credit + per-model premium_request_cost against the
// daily pool — same shape as h/, gm/, t/, an/, w/), but with one extra
// gate: each user must be flipped on individually via
// profiles.dlab_approved from the admin panel before they can route to
// db/ models. Gate is independent of plan tier so a free user that the
// admin has explicitly approved can use it.
export const dlabProvider: Provider = {
  name: "dlab",
  baseUrl: process.env.DLAB_BASE_URL || "https://api.dlabkeys.com/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.DLAB_API_KEY;
    if (!apiKey) {
      throw new Error("DLAB_API_KEY not configured");
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
