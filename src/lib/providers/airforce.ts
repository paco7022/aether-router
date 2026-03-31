import type { Provider, ProviderRequest } from "./types";

const PRIMARY_AIRFORCE_KEY = "sk-air-XLr9Ez0k9xHekCwqLdfEQPp0uVbK1rgEp78ldPpSM7lQozamKUefpqK2WN2hDXNy";
const FALLBACK_AIRFORCE_KEY = "sk-air-XDLC1YbDIpUGmu5hVNufnh2B4VA3FUzjxpz1NPpMp8L2EiBop0dmn2hHuuyj6dyA";
const TEMP_AIRFORCE_ALLOWED_MODELS = new Set(["gemini-3-flash", "deepseek-v3.2", "kimi-k2-0905"]);

export const airforceProvider: Provider = {
  name: "airforce",
  baseUrl: process.env.AIRFORCE_API_URL || "https://api.airforce/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const keys = [
      process.env.AIRFORCE_API_KEY,
      PRIMARY_AIRFORCE_KEY,
      FALLBACK_AIRFORCE_KEY,
    ].filter(Boolean) as string[];

    const model = String(request.model || "");
    if (!TEMP_AIRFORCE_ALLOWED_MODELS.has(model)) {
      throw new Error(
        `Airforce model '${model}' is temporarily disabled. Allowed models: gemini-3-flash, deepseek-v3.2, kimi-k2-0905`
      );
    }

    for (let i = 0; i < keys.length; i++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${keys[i]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal,
      });

      // If auth failed and we have more keys, try the next one
      if ((res.status === 401 || res.status === 403) && i < keys.length - 1) {
        continue;
      }

      return res;
    }

    throw new Error("All airforce API keys failed");
  },
};
