import type { Provider, ProviderRequest } from "./types";

export const geminiCliProvider: Provider = {
  name: "gemini-cli",
  baseUrl: process.env.GEMINI_CLI_URL || process.env.GEMINI_PROXY_URL || "http://localhost:8964/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.GEMINI_CLI_API_KEY || process.env.GEMINI_PROXY_PASSWORD || "77777";

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
