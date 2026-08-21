"use client";

// Free tier removed (2026-08-21). Accounts on plan_id='free' route only if
// they bought credits (profiles.is_paid + at least MIN_PAID_CREDITS), so the
// dashboard tells them why before they hit a 402 in the chat or on their API
// key — and, for pay-as-you-go accounts, how close the balance is to cutting
// them off. Replaces DiscordVerifyBanner, whose countdown only policed free
// routing.

import { useEffect, useState } from "react";
import Link from "next/link";
import { MIN_PAID_CREDITS } from "@/lib/free-tier";

// Warn a pay-as-you-go account while it can still top up, not once it is cut
// off: 10x the floor is roughly one day of light use.
const LOW_BALANCE_WARNING = MIN_PAID_CREDITS * 10;

type BannerState = false | "blocked" | "low";

export function FreeTierEndedBanner() {
  const [show, setShow] = useState<BannerState>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: p } = await supabase
        .from("profiles")
        .select("plan_id, is_paid, credits")
        .eq("id", user.id)
        .single();

      if (!p || cancelled) return;
      const noPlan = p.plan_id === "free" || p.plan_id == null;
      if (!noPlan) return;
      // Paying by credits: only warn when the balance is about to cut them off.
      if (p.is_paid === true) {
        if (Number(p.credits ?? 0) < LOW_BALANCE_WARNING) setShow("low");
        return;
      }
      setShow("blocked");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const low = show === "low";

  return (
    <div
      className="mb-6 rounded-xl px-4 py-3 text-xs flex items-center justify-between gap-3 flex-wrap"
      style={{
        background: low
          ? "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,191,36,0.05))"
          : "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(251,191,36,0.06))",
        border: low ? "1px solid rgba(251,191,36,0.30)" : "1px solid rgba(239,68,68,0.30)",
        color: low ? "rgba(253,224,71,0.95)" : "rgba(252,165,165,0.95)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="leading-relaxed min-w-0">
          {low ? (
            <>
              <span className="font-semibold">Your pay-as-you-go balance is running low.</span>{" "}
              Routing stops below {MIN_PAID_CREDITS.toLocaleString()} credits. Top up to keep your
              API keys and chat working.
            </>
          ) : (
            <>
              <span className="font-semibold">The free tier has been discontinued.</span>{" "}
              Your account no longer routes requests (API or chat). Your credits and history stay —
              subscribe to a plan, or buy at least {MIN_PAID_CREDITS.toLocaleString()} credits to
              route pay-as-you-go.
            </>
          )}
        </p>
      </div>
      <Link
        href="/dashboard/billing"
        className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium btn-teal text-white"
      >
        {low ? "Top up" : "See plans"}
      </Link>
    </div>
  );
}
