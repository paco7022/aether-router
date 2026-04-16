"use client";

import { useEffect, useRef } from "react";
import { getFingerprint } from "@/lib/fingerprint";

/**
 * Sends the device fingerprint to the server after auth.
 * Returns early if already sent this session.
 */
export function useFingerprintCapture() {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    (async () => {
      try {
        const fp = await getFingerprint();
        await fetch("/api/v1/fingerprint", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "AetherRouter",
          },
          body: JSON.stringify({ fingerprint: fp }),
        });
      } catch {
        // Silent fail — fingerprint is best-effort
      }
    })();
  }, []);
}

/**
 * Pre-checks if the device is banned before registration.
 * Returns { banned, reason } or null if check fails.
 */
export async function checkFingerprintBan(): Promise<{
  banned: boolean;
  reason?: string;
  fingerprint: string;
} | null> {
  try {
    const fp = await getFingerprint();
    const res = await fetch("/api/v1/fingerprint/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: fp }),
    });
    const data = await res.json();
    return { ...data, fingerprint: fp };
  } catch {
    return null;
  }
}
