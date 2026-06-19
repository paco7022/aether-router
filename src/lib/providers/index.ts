import type { Provider } from "./types";
import { nanoProvider } from "./nano";
import { webproxyProvider } from "./webproxy";
import { hapuppyProvider } from "./hapuppy";
import { gameronProvider } from "./gameron";
import { openrouterProvider } from "./openrouter";
import { dlabProvider } from "./dlab";
import { riftaiProvider } from "./riftai";
import { opencodeProvider } from "./opencode";
import { trolllmProvider } from "./trolllm";
import { orbitProvider } from "./orbit";
import { routmyProvider } from "./routmy";
import { deepseekProvider } from "./deepseek";

const providers: Record<string, Provider> = {
  nano: nanoProvider,
  deepseek: deepseekProvider,
  webproxy: webproxyProvider,
  hapuppy: hapuppyProvider,
  gameron: gameronProvider,
  openrouter: openrouterProvider,
  dlab: dlabProvider,
  riftai: riftaiProvider,
  opencode: opencodeProvider,
  trolllm: trolllmProvider,
  orbit: orbitProvider,
  routmy: routmyProvider,
};

export function getProvider(name: string): Provider | undefined {
  return providers[name];
}

export function getAllProviders(): Provider[] {
  return Object.values(providers);
}
