"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const OPTIONS = [
  { type: "hour" as const,      label: "1-Hour Boost",  cost: 2_500,   desc: "Doubles your context limit for 1 hour" },
  { type: "permanent" as const, label: "Permanent",     cost: 150_000, desc: "Doubles your context limit for the duration of your plan" },
];

export function ContextBoostCard({
  baseMaxContext,
  boostExpiresAt,
  totalCredits,
}: {
  baseMaxContext: number;
  boostExpiresAt: string | null;
  totalCredits: number;
}) {
  const [loading, setLoading] = useState<"hour" | "permanent" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const router = useRouter();

  const isBoostActive =
    !!boostExpiresAt &&
    (boostExpiresAt === "infinity" || new Date(boostExpiresAt) > new Date());

  const isPermanent = boostExpiresAt === "infinity";
  const expiresDate =
    boostExpiresAt && boostExpiresAt !== "infinity" ? new Date(boostExpiresAt) : null;

  const fmt = (n: number) =>
    n >= 1024 ? `${Math.round(n / 1024)}k` : `${n}`;

  async function purchase(type: "hour" | "permanent") {
    setLoading(type);
    setMessage(null);
    const res = await fetch("/api/v1/boost/context", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
      body: JSON.stringify({ type }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage({ text: type === "hour" ? "1-hour boost activated!" : "Permanent boost activated!", ok: true });
      router.refresh();
    } else {
      setMessage({ text: data.error || "Purchase failed", ok: false });
    }
    setLoading(null);
  }

  return (
    <div className="glass-card shimmer-line p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-teal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
          <div>
            <h4 className="font-semibold text-sm text-white/85">Context Limit Boost</h4>
            <p className="text-xs text-[var(--text-muted)]">Doubles your max context window for premium models</p>
          </div>
        </div>
        {isBoostActive && (
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-medium badge-teal shrink-0">
            Active
          </span>
        )}
      </div>

      {/* Current status */}
      <div className="flex items-center gap-6 mb-4 px-3 py-2.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div>
          <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Base limit</p>
          <p className="text-base font-bold text-white/70">{fmt(baseMaxContext)} tokens</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
        </svg>
        <div>
          <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Boosted limit</p>
          <p className="text-base font-bold aurora-text">{fmt(baseMaxContext * 2)} tokens</p>
        </div>
        {isBoostActive && (
          <>
            <div className="ml-auto text-right">
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Expires</p>
              <p className="text-sm font-semibold text-teal-400">
                {isPermanent ? "Never" : expiresDate?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Purchase options */}
      {!isBoostActive || !isPermanent ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {OPTIONS.map((opt) => {
            const canAfford = totalCredits >= opt.cost;
            const isLoading = loading === opt.type;
            const alreadyActive = isBoostActive && opt.type === "hour";
            return (
              <button
                key={opt.type}
                onClick={() => purchase(opt.type)}
                disabled={!canAfford || isLoading || !!loading || alreadyActive}
                className={`flex flex-col items-start text-left rounded-xl p-4 transition-all ${
                  alreadyActive
                    ? "opacity-40 cursor-not-allowed"
                    : canAfford && !loading
                    ? "hover:scale-[1.02] cursor-pointer"
                    : "opacity-50 cursor-not-allowed"
                }`}
                style={{
                  background: opt.type === "permanent"
                    ? "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(34,211,238,0.05))"
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${opt.type === "permanent" ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.07)"}`,
                }}
              >
                <div className="flex items-center justify-between w-full mb-1.5">
                  <span className="text-sm font-semibold text-white/85">{opt.label}</span>
                  {alreadyActive && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full badge-teal">Current</span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-3">{opt.desc}</p>
                <div className="flex items-center justify-between w-full">
                  <span className={`text-base font-bold ${opt.type === "permanent" ? "aurora-text" : "text-teal-400"}`}>
                    {opt.cost.toLocaleString()} credits
                  </span>
                  {isLoading && (
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  )}
                  {!canAfford && (
                    <span className="text-[10px] text-red-400/70">Not enough credits</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)] text-center py-2">
          Your context limit is permanently doubled. No further action needed.
        </p>
      )}

      {/* Feedback message */}
      {message && (
        <p className={`text-sm mt-3 font-medium ${message.ok ? "text-teal-400" : "text-red-400/80"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
