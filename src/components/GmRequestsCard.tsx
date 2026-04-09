"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GmRequestsCard({
  used,
  limit,
  claimed,
}: {
  used: number;
  limit: number;
  claimed: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(claimed);
  const [message, setMessage] = useState("");
  const router = useRouter();

  const isUnlimited = limit === 0;
  const remaining = isUnlimited ? Infinity : Math.max(0, limit - used);
  const pct = isUnlimited ? 0 : limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

  async function handleClaim() {
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/v1/billing/claim-gm", { method: "POST" });
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

  // ALL users must claim daily to unlock gm/ models
  const needsClaim = !hasClaimed;

  return (
    <div className="glass-card shimmer-line p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold text-sm text-white/85">Premium Model Requests</h4>
          <p className="text-xs text-[var(--text-muted)]">
            Daily usage for premium models (gm/, c/ and an/)
          </p>
        </div>
        <div className="flex gap-1">
          <span
            className="text-[10px] px-2.5 py-0.5 rounded-full font-medium"
            style={{
              background: "rgba(139, 92, 246, 0.1)",
              border: "1px solid rgba(139, 92, 246, 0.15)",
              color: "rgba(167, 139, 250, 0.9)",
            }}
          >
            gm/
          </span>
          <span
            className="text-[10px] px-2.5 py-0.5 rounded-full font-medium"
            style={{
              background: "rgba(34, 211, 238, 0.1)",
              border: "1px solid rgba(34, 211, 238, 0.15)",
              color: "rgba(34, 211, 238, 0.9)",
            }}
          >
            c/
          </span>
          <span
            className="text-[10px] px-2.5 py-0.5 rounded-full font-medium"
            style={{
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.15)",
              color: "rgba(251, 191, 36, 0.9)",
            }}
          >
            an/
          </span>
        </div>
      </div>

      {needsClaim ? (
        <div className="text-center py-4">
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Claim your daily premium requests to use gm/ and an/ models.
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
                  <>{used.toLocaleString()} <span className="text-[var(--text-muted)]">/ {limit.toLocaleString()}</span></>
                )}
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255, 255, 255, 0.04)" }}>
              {isUnlimited ? (
                <div className="h-full rounded-full w-full" style={{ background: "linear-gradient(90deg, rgba(139, 92, 246, 0.3), rgba(34, 211, 238, 0.2))" }} />
              ) : (
                <div
                  className="h-full rounded-full transition-all"
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
                : "Limit reached — upgrade for more"}
            </span>
            {message && (
              <span className="text-violet-400 font-medium">{message}</span>
            )}
          </div>

          <p className="text-[10px] text-[var(--text-muted)] mt-2 leading-relaxed">
            Claude models use <span className="text-red-400/80 font-medium">2 requests</span> per call · Gemini Pro uses <span className="text-amber-400/80 font-medium">1 request</span> · Gemini Flash uses <span className="text-green-400/80 font-medium">0.5 requests</span>
          </p>
        </>
      )}
    </div>
  );
}
