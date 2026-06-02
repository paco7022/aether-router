"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const COST = 50_000;

export function TDiscountCard({
  discountExpiresAt,
  totalCredits,
}: {
  discountExpiresAt: string | null;
  totalCredits: number;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const router = useRouter();

  const isActive =
    !!discountExpiresAt && new Date(discountExpiresAt) > new Date();
  const expiresDate = discountExpiresAt ? new Date(discountExpiresAt) : null;
  const canAfford = totalCredits >= COST;

  async function purchase() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/v1/billing/t-discount", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage({ text: "t/ half-price activated for 30 days!", ok: true });
      router.refresh();
    } else {
      setMessage({ text: data.error || "Purchase failed", ok: false });
    }
    setLoading(false);
  }

  return (
    <div className="glass-card shimmer-line p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <line x1="19" y1="5" x2="5" y2="19" />
            <circle cx="6.5" cy="6.5" r="2.5" />
            <circle cx="17.5" cy="17.5" r="2.5" />
          </svg>
          <div>
            <h4 className="font-semibold text-sm text-white/85">t/ Half-Price Package</h4>
            <p className="text-xs text-[var(--text-muted)]">Halves your t/ premium cost — Opus 6→3, Sonnet 3→1.5 requests</p>
          </div>
        </div>
        {isActive && (
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-medium badge-teal shrink-0">
            Active
          </span>
        )}
      </div>

      {/* Active status */}
      {isActive && (
        <div className="flex items-center justify-between mb-4 px-3 py-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <p className="text-xs text-[var(--text-muted)]">Your t/ requests are at half price.</p>
          <div className="text-right">
            <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Expires</p>
            <p className="text-sm font-semibold text-teal-400">
              {expiresDate?.toLocaleDateString([], { month: "short", day: "numeric" })}
            </p>
          </div>
        </div>
      )}

      {/* Purchase */}
      <button
        onClick={purchase}
        disabled={!canAfford || loading}
        className={`flex items-center justify-between w-full text-left rounded-xl p-4 transition-all ${
          canAfford && !loading ? "hover:scale-[1.02] cursor-pointer" : "opacity-50 cursor-not-allowed"
        }`}
        style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(34,211,238,0.05))",
          border: "1px solid rgba(139,92,246,0.2)",
        }}
      >
        <div>
          <span className="text-sm font-semibold text-white/85">
            {isActive ? "Extend 30 days" : "Buy — 30 days"}
          </span>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Stacks on remaining time</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold aurora-text">{COST.toLocaleString()} credits</span>
          {loading && (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {!canAfford && !loading && (
            <span className="text-[10px] text-red-400/70">Not enough credits</span>
          )}
        </div>
      </button>

      {/* Feedback */}
      {message && (
        <p className={`text-sm mt-3 font-medium ${message.ok ? "text-teal-400" : "text-red-400/80"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
