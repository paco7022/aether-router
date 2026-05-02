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
//
// trolllm is NOT in this list right now: the upstream keys are about
// to expire, so t/ runs as a free provider until they're rotated out.
const PREMIUM_PROVIDERS = new Set<string>([
  "webproxy",
  "hapuppy",
  "gameron",
  "dlab",
  "riftai",
]);

export function isPremiumProvider(provider: string | null | undefined): boolean {
  return !!provider && PREMIUM_PROVIDERS.has(provider);
}

const FREE_PROVIDERS = new Set<string>();

export function isFreeProvider(provider: string | null | undefined): boolean {
  return !!provider && FREE_PROVIDERS.has(provider);
}

// Flat-rate providers: charge a fixed per-request fee (stored in the model's
// premium_request_cost column, reinterpreted as "credits per request")
// instead of per-token billing. No context limits, no premium pool.
const FLAT_RATE_PROVIDERS = new Set<string>(["openrouter"]);

export function isFlatRateProvider(provider: string | null | undefined): boolean {
  return !!provider && FLAT_RATE_PROVIDERS.has(provider);
}
