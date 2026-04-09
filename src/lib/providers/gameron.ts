import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Key rotation system for Gameron.
 *
 * Primary key handles up to 5 simultaneous requests.
 * If primary is full (>= 5 in-flight), overflow to secondary key.
 * After secondary handles the request, traffic returns to primary.
 * If only one key is configured, use it exclusively.
 */

interface KeySlot {
  key: string;
  active: number;       // current in-flight requests
}

const PRIMARY_MAX_CONCURRENT = 5;
const SECONDARY_MAX_CONCURRENT = 2;

const slots: { primary: KeySlot | null; secondary: KeySlot | null } = {
  primary: null,
  secondary: null,
};

function initSlots() {
  if (slots.primary) return; // already initialised

  const primaryKey = process.env.GAMERON_PRIMARY_KEY;
  const secondaryKey = process.env.GAMERON_SECONDARY_KEY;

  if (primaryKey) {
    slots.primary = { key: primaryKey, active: 0 };
  }
  if (secondaryKey) {
    slots.secondary = { key: secondaryKey, active: 0 };
  }
}

function pickSlot(): KeySlot {
  initSlots();

  const p = slots.primary;
  const s = slots.secondary;

  if (!p && !s) throw new Error("GAMERON_PRIMARY_KEY or GAMERON_SECONDARY_KEY must be configured");
  if (!p) return s!;
  if (!s) return p;

  // Primary handles up to 5 concurrent requests; overflow to secondary if it has capacity
  if (p.active >= PRIMARY_MAX_CONCURRENT && s.active < SECONDARY_MAX_CONCURRENT) {
    return s;
  }

  return p;
}

export const gameronProvider: Provider = {
  name: "gameron",
  baseUrl: process.env.GAMERON_BASE_URL || "https://api.gameron.me/v1",

  async forward(request: ProviderRequest, signal?: AbortSignal): Promise<Response> {
    const slot = pickSlot();
    slot.active++;

    try {
      let lastResponse: Response | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        }

        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${slot.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal,
        });

        // Retry on 403/429/5xx from upstream, return immediately on success or client errors
        if (res.ok || (res.status >= 400 && res.status < 403) || res.status === 404) {
          return res;
        }

        lastResponse = res;
      }

      return lastResponse!;
    } finally {
      slot.active--;
    }
  },
};
