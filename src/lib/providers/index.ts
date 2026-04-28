import type { Provider } from "./types";
import { airforceProvider } from "./airforce";
import { geminiCliProvider } from "./gemini-cli";
import { trolllmProvider } from "./trolllm";
import { antigravityProvider } from "./antigravity";
import { nanoProvider } from "./nano";
import { webproxyProvider } from "./webproxy";
import { hapuppyProvider } from "./hapuppy";
import { gameronProvider } from "./gameron";
import { openrouterProvider } from "./openrouter";
import { dlabProvider } from "./dlab";
import { riftaiProvider } from "./riftai";

const providers: Record<string, Provider> = {
  airforce: airforceProvider,
  "gemini-cli": geminiCliProvider,
  trolllm: trolllmProvider,
  antigravity: antigravityProvider,
  nano: nanoProvider,
  webproxy: webproxyProvider,
  hapuppy: hapuppyProvider,
  gameron: gameronProvider,
  openrouter: openrouterProvider,
  dlab: dlabProvider,
  riftai: riftaiProvider,
};

export function getProvider(name: string): Provider | undefined {
  return providers[name];
}

export function getAllProviders(): Provider[] {
  return Object.values(providers);
}
