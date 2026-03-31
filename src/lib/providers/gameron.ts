import type { Provider, ProviderRequest } from "./types";

// Temporary provider for testing — key expires ~5h from now, free models
export const gameronProvider: Provider = {
  name: "gameron",
  baseUrl: "https://api.gameron.me/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = "sk-user-26362df37e200b57bb1a69160e73506e";

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
