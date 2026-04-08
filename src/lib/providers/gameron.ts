import type { Provider, ProviderRequest } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Key rotation system for Gameron.
 *
 * Primary key   (500M tokens): handles 5-15 concurrent users.
 * Secondary key (100M tokens): fallback, up to 5 concurrent users.
 *
 * Routing logic:
 *  - While primary has < 15 active requests  -> use primary.
 *  - If primary is at 15 and secondary has room (< 5) -> use secondary.
 *  - If both are full -> still use primary (best-effort, has the larger pool).
 */

interface KeySlot {
  key: string;
  active: number;       // current in-flight requests
  maxConcurrent: number; // soft cap
}

const slots: { primary: KeySlot | null; secondary: KeySlot | null } = {
  primary: null,
  secondary: null,
};

function initSlots() {
  if (slots.primary) return; // already initialised

  const primaryKey = process.env.GAMERON_PRIMARY_KEY;
  const secondaryKey = process.env.GAMERON_SECONDARY_KEY;

  if (primaryKey) {
    slots.primary = { key: primaryKey, active: 0, maxConcurrent: 15 };
  }
  if (secondaryKey) {
    slots.secondary = { key: secondaryKey, active: 0, maxConcurrent: 5 };
  }
}

function pickSlot(): KeySlot {
  initSlots();

  const p = slots.primary;
  const s = slots.secondary;

  if (!p && !s) throw new Error("GAMERON_PRIMARY_KEY or GAMERON_SECONDARY_KEY must be configured");
  if (!p) return s!;
  if (!s) return p;

  // Primary still has room -> use it
  if (p.active < p.maxConcurrent) return p;

  // Primary full, secondary has room -> fallback
  if (s.active < s.maxConcurrent) return s;

  // Both full -> best-effort on primary (larger token pool)
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
