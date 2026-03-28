import type { Provider, ProviderRequest } from "./types";

export const airforceProvider: Provider = {
  name: "airforce",
  baseUrl: "https://api.airforce/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.AIRFORCE_API_KEY;
    if (!apiKey) {
      throw new Error("AIRFORCE_API_KEY not configured");
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
