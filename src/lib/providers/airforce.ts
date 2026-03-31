import type { Provider, ProviderRequest } from "./types";

const TEMP_AIRFORCE_KEY = "sk-air-XDLC1YbDIpUGmu5hVNufnh2B4VA3FUzjxpz1NPpMp8L2EiBop0dmn2hHuuyj6dyA";
const TEMP_AIRFORCE_ALLOWED_MODELS = new Set(["gemini-3-flash", "deepseek-v3.2", "kimi-k2-0905"]);

export const airforceProvider: Provider = {
  name: "airforce",
  baseUrl: process.env.AIRFORCE_API_URL || "https://api.airforce/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.AIRFORCE_API_KEY || TEMP_AIRFORCE_KEY;
    if (!apiKey) {
      throw new Error("AIRFORCE_API_KEY not configured");
    }

    const model = String(request.model || "");
    if (!TEMP_AIRFORCE_ALLOWED_MODELS.has(model)) {
      throw new Error(
        `Airforce model '${model}' is temporarily disabled. Allowed models: gemini-3-flash, deepseek-v3.2, kimi-k2-0905`
      );
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
