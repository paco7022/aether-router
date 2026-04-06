import type { Provider } from "./types";
import { airforceProvider } from "./airforce";
import { geminiCliProvider } from "./gemini-cli";
import { gameronProvider } from "./gameron";
import { lightningzeusProvider } from "./lightningzeus";

const providers: Record<string, Provider> = {
  airforce: airforceProvider,
  "gemini-cli": geminiCliProvider,
  gameron: gameronProvider,
  lightningzeus: lightningzeusProvider,
};

export function getProvider(name: string): Provider | undefined {
  return providers[name];
}

export function getAllProviders(): Provider[] {
  return Object.values(providers);
}
