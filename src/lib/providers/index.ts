import type { Provider } from "./types";
import { airforceProvider } from "./airforce";
import { geminiCliProvider } from "./gemini-cli";
import { gameronProvider } from "./gameron";
import { lightningzeusProvider } from "./lightningzeus";
import { antigravityProvider } from "./antigravity";
import { nanoProvider } from "./nano";

const providers: Record<string, Provider> = {
  airforce: airforceProvider,
  "gemini-cli": geminiCliProvider,
  gameron: gameronProvider,
  lightningzeus: lightningzeusProvider,
  antigravity: antigravityProvider,
  nano: nanoProvider,
};

export function getProvider(name: string): Provider | undefined {
  return providers[name];
}

export function getAllProviders(): Provider[] {
  return Object.values(providers);
}
