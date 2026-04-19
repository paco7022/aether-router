"use client";

import { useEffect, useRef } from "react";
import { getFingerprint } from "@/lib/fingerprint";
import { createClient } from "@/lib/supabase/client";

/**
 * Sends the device fingerprint to the server after auth.
 * Returns early if already sent this session.
 */
export function useFingerprintCapture() {
  const sent = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    if (sent.current) return;

    (async () => {
      try {
        const fp = await getFingerprint();
        const fpRes = await fetch("/api/v1/fingerprint", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "AetherRouter",
          },
          body: JSON.stringify({ fingerprint: fp }),
        });

        if (!fpRes.ok) {
          const payload = await fpRes.json().catch(() => ({}));
          const reason =
            (payload as { reason?: string; error?: string }).reason ||
            (payload as { reason?: string; error?: string }).error ||
            "This device is blocked from accessing the app.";

          await supabase.auth.signOut();
          window.location.href = `/login?error=banned&reason=${encodeURIComponent(reason)}`;
          return;
        }

        sent.current = true;

        // Redeem pending referral (covers OAuth, where /register couldn't
        // call redeem directly). Safe if already redeemed — the RPC
        // rejects a second attempt with "Already referred".
        const pendingRef = sessionStorage.getItem("aether_ref");
        if (pendingRef) {
          try {
            await fetch("/api/v1/referral/redeem", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "AetherRouter",
              },
              body: JSON.stringify({ code: pendingRef, fingerprint: fp }),
            });
          } finally {
            sessionStorage.removeItem("aether_ref");
          }
        }
      } catch {
        // Keep app usable for transient client-side failures.
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 403) {
      return null;
    }
    return { ...data, fingerprint: fp };
  } catch {
    return null;
  }
}
