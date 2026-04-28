export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ProviderUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface Provider {
  name: string;
  baseUrl: string;
  forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response>;
}

// Single source of truth for "premium providers" — those that bill flat
// 1 credit per request and consume premium-request budget. Keep this
// list in sync when adding/removing premium providers; everything else
// in the app derives from `isPremiumProvider()`.
const PREMIUM_PROVIDERS = new Set<string>([
  "trolllm",
  "antigravity",
  "webproxy",
  "hapuppy",
  "gameron",
  "dlab",
  "riftai",
]);

export function isPremiumProvider(provider: string | null | undefined): boolean {
  return !!provider && PREMIUM_PROVIDERS.has(provider);
}
