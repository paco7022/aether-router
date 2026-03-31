import type { Provider, ProviderRequest } from "./types";

export const gameronProvider: Provider = {
  name: "gameron",
  baseUrl: process.env.GAMERON_BASE_URL || "https://api.gameron.me/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.GAMERON_API_KEY;
    if (!apiKey) {
      throw new Error("GAMERON_API_KEY not configured");
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

    return res;
  },
};
