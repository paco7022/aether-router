"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type BannerState =
  | { show: false }
  | { show: true; urgent: boolean; daysLeft: number };

const DiscordLogo = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.332-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z" />
  </svg>
);

export function DiscordVerifyBanner() {
  const [state, setState] = useState<BannerState>({ show: false });

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase
        .from("profiles")
        .select("plan_id, discord_verified, discord_link_required_by")
        .eq("id", user.id)
        .single();

      if (!p) return;
      const isFree = p.plan_id === "free" || p.plan_id == null;
      if (!isFree || p.discord_verified === true || !p.discord_link_required_by) return;

      const deadline = new Date(p.discord_link_required_by).getTime();
      const now = Date.now();
      const daysLeft = Math.max(0, Math.ceil((deadline - now) / 86_400_000));
      setState({ show: true, urgent: now >= deadline, daysLeft });
    })();
  }, []);

  if (!state.show) return null;

  const urgent = state.urgent;

  return (
    <div
      className="mb-6 rounded-xl px-4 py-3 text-xs flex items-center justify-between gap-3 flex-wrap"
      style={{
        background: urgent
          ? "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.06))"
          : "linear-gradient(135deg, rgba(88,101,242,0.10), rgba(139,92,246,0.06))",
        border: urgent ? "1px solid rgba(239,68,68,0.30)" : "1px solid rgba(88,101,242,0.25)",
        color: urgent ? "rgba(252,165,165,0.95)" : "rgba(199,210,254,0.95)",
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={urgent ? "text-red-300" : "text-[#7b86f5]"}>
          <DiscordLogo size={18} />
        </span>
        <p className="leading-relaxed">
          {urgent ? (
            <>
              <span className="font-semibold text-red-200">Your free plan is paused.</span>{" "}
              Verify your Discord account to restore access.
            </>
          ) : (
            <>
              <span className="font-semibold text-indigo-200">Verify your Discord</span> to keep your free
              plan active — <span className="font-semibold">{state.daysLeft} day{state.daysLeft === 1 ? "" : "s"} left</span>.
            </>
          )}
        </p>
      </div>
      <Link
        href="/dashboard/discord"
        className="shrink-0 inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
        style={{
          background: urgent ? "linear-gradient(135deg,#ef4444,#f87171)" : "linear-gradient(135deg,#5865f2,#7b86f5)",
          border: urgent ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(123,134,245,0.4)",
        }}
      >
        <DiscordLogo size={14} />
        Verify now
      </Link>
    </div>
  );
}
