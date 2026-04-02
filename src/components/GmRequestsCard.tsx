"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GmRequestsCard({
  used,
  limit,
  claimed,
  isFree,
}: {
  used: number;
  limit: number;
  claimed: boolean;
  isFree: boolean;
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
      setMessage(`${limit} premium requests unlocked for today!`);
      router.refresh();
    } else {
      setMessage(data.error || "Failed to claim");
    }

    setLoading(false);
  }

  // Free users who haven't claimed yet
  const needsClaim = isFree && !hasClaimed;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold text-sm">Premium Model Requests</h4>
          <p className="text-xs text-[var(--text-muted)]">
            Daily usage for gm/ models (Claude, GPT, Gemini)
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
          gm/
        </span>
      </div>

      {needsClaim ? (
        <div className="text-center py-4">
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Claim your daily premium requests to use gm/ models.
          </p>
          <button
            onClick={handleClaim}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg px-5 py-2.5 text-sm transition-all hover:scale-105 disabled:opacity-50"
          >
            {loading ? "Claiming..." : `Claim ${limit} requests`}
          </button>
          {message && (
            <p className="text-sm text-red-400 mt-2">{message}</p>
          )}
        </div>
      ) : (
        <>
          {/* Progress bar */}
          <div className="mb-2">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--text-muted)]">Used today</span>
              <span className="font-medium">
                {isUnlimited ? (
                  <>{used.toLocaleString()} <span className="text-[var(--text-muted)]">/ unlimited</span></>
                ) : (
                  <>{used.toLocaleString()} <span className="text-[var(--text-muted)]">/ {limit.toLocaleString()}</span></>
                )}
              </span>
            </div>
            <div className="w-full h-2 bg-[var(--bg-hover)] rounded-full overflow-hidden">
              {isUnlimited ? (
                <div className="h-full bg-purple-500/30 rounded-full w-full" />
              ) : (
                <div
                  className={`h-full rounded-full transition-all ${
                    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-purple-500"
                  }`}
                  style={{ width: `${pct}%` }}
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
              <span className="text-purple-400 font-medium">{message}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
