"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GmRequestsCard({
  used,
  limit,
  debt = 0,
  claimed,
}: {
  used: number;
  limit: number;
  debt?: number;
  claimed: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(claimed);
  const [message, setMessage] = useState("");
  const router = useRouter();

  const isUnlimited = limit === 0;
  // Debt counts against the daily cap inside reserve_premium_request, so
  // surface it the same way: bar fill = used + debt vs limit.
  const effectiveUsed = used + debt;
  const remaining = isUnlimited ? Infinity : Math.max(0, limit - effectiveUsed);
  const pct = isUnlimited ? 0 : limit > 0 ? Math.min((effectiveUsed / limit) * 100, 100) : 0;

  async function handleClaim() {
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/v1/billing/claim-gm", { method: "POST", headers: { "X-Requested-With": "AetherRouter" } });
    const data = await res.json();

    if (res.ok) {
      setHasClaimed(true);
      const label = isUnlimited ? "Unlimited" : `${limit}`;
      setMessage(`${label} premium requests unlocked for today!`);
      router.refresh();
    } else {
      setMessage(data.error || "Failed to claim");
    }

    setLoading(false);
  }

  const needsClaim = !hasClaimed;

  return (
    <div className="glass-card shimmer-line p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <div>
            <h4 className="font-semibold text-sm text-white/85">Premium Model Requests</h4>
            <p className="text-xs text-[var(--text-muted)]">
              Daily usage for premium models (t/, an/, w/, h/, gm/)
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-medium badge-violet">t/</span>
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-medium badge-cyan">h/</span>
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-medium badge-amber">gm/</span>
        </div>
      </div>

      {needsClaim ? (
        <div className="text-center py-4">
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Claim your daily premium requests to use an/ models (t/, w/, h/, gm/ work without claim).
          </p>
          <button
            onClick={handleClaim}
            disabled={loading}
            className="btn-aurora font-medium px-5 py-2.5 text-sm transition-all hover:scale-[1.02] disabled:opacity-50"
          >
            {loading ? "Claiming..." : `Claim ${limit} requests`}
          </button>
          {message && (
            <p className="text-sm text-red-400/80 mt-2">{message}</p>
          )}
        </div>
      ) : (
        <>
          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-[var(--text-muted)]">Used today</span>
              <span className="font-medium text-white/80">
                {isUnlimited ? (
                  <>{used.toLocaleString()} <span className="text-[var(--text-muted)]">/ unlimited</span></>
                ) : (
                  <>{effectiveUsed.toLocaleString()} <span className="text-[var(--text-muted)]">/ {limit.toLocaleString()}</span></>
                )}
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255, 255, 255, 0.04)" }}>
              {isUnlimited ? (
                <div className="h-full rounded-full w-full" style={{ background: "linear-gradient(90deg, rgba(139, 92, 246, 0.3), rgba(34, 211, 238, 0.2))" }} />
              ) : (
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 90
                      ? "linear-gradient(90deg, #f87171, #ef4444)"
                      : pct >= 70
                      ? "linear-gradient(90deg, #fbbf24, #f59e0b)"
                      : "linear-gradient(90deg, #8b5cf6, #22d3ee)",
                  }}
                />
              )}
            </div>
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="text-[var(--text-muted)]">
              {isUnlimited
                ? "Unlimited requests"
                : remaining > 0
                ? `${remaining} remaining`
                : "Limit reached -- upgrade for more"}
            </span>
            {message && (
              <span className="text-violet-400 font-medium">{message}</span>
            )}
          </div>

          {debt > 0 && (
            <div className="mt-2.5 px-3 py-2 rounded-md border border-red-500/20 bg-red-500/5">
              <p className="text-[11px] text-red-300/90 leading-relaxed">
                <span className="font-semibold">{debt} premium requests blocked by debt</span> —
                accrued from prompts that exceeded your plan&apos;s context cap. Contact support to clear.
              </p>
            </div>
          )}

          <p className="text-[10px] text-[var(--text-muted)] mt-2.5 leading-relaxed">
            Cost depends on the model: Opus = <span className="text-red-400/80 font-medium">8-9</span>, Sonnet = <span className="text-amber-400/80 font-medium">2-3</span>, Haiku/Flash = <span className="text-green-400/80 font-medium">0.5-1</span> per call.
          </p>
        </>
      )}
    </div>
  );
}
