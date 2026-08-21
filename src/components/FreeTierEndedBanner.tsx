"use client";

// Free tier removed (2026-08-21). Accounts still sitting on plan_id='free'
// keep their credits and history but no longer route, so the dashboard tells
// them why before they hit a 402 in the chat or on their API key.
// Replaces DiscordVerifyBanner, whose countdown only policed free routing.

import { useEffect, useState } from "react";
import Link from "next/link";

export function FreeTierEndedBanner() {
  const [show, setShow] = useState(false);

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
        .select("plan_id")
        .eq("id", user.id)
        .single();

      if (!p || cancelled) return;
      if (p.plan_id === "free" || p.plan_id == null) setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div
      className="mb-6 rounded-xl px-4 py-3 text-xs flex items-center justify-between gap-3 flex-wrap"
      style={{
        background: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(251,191,36,0.06))",
        border: "1px solid rgba(239,68,68,0.30)",
        color: "rgba(252,165,165,0.95)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="leading-relaxed min-w-0">
          <span className="font-semibold">The free tier has been discontinued.</span>{" "}
          Your account no longer routes requests (API or chat). Your credits and history stay —
          pick a plan to start using the models again.
        </p>
      </div>
      <Link
        href="/dashboard/billing"
        className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium btn-teal text-white"
      >
        See plans
      </Link>
    </div>
  );
}
