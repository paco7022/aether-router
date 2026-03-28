import type { Provider } from "./types";
import { airforceProvider } from "./airforce";

const providers: Record<string, Provider> = {
  airforce: airforceProvider,
};

export function getProvider(name: string): Provider | undefined {
  return providers[name];
}

export function getAllProviders(): Provider[] {
  return Object.values(providers);
}
