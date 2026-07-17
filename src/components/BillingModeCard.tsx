"use client";

import { useState } from "react";

type BillingMode = "request" | "payg";

const MODES: {
  id: BillingMode;
  title: string;
  tagline: string;
  points: string[];
}[] = [
  {
    id: "request",
    title: "Per request",
    tagline: "Flat rate — best for everyday chat",
    points: [
      "1 credit per request, plus your plan's premium requests",
      "Cheaper for normal-length conversations",
      "Limited by your plan's context cap",
    ],
  },
  {
    id: "payg",
    title: "Pay as you go",
    tagline: "Per token — best for huge contexts",
    points: [
      "No context limit at all — send as much as you want",
      "Doesn't touch your daily premium requests",
      "You pay for every token, so it costs more per request",
    ],
  },
];

export function BillingModeCard({ initialMode }: { initialMode: BillingMode }) {
  const [mode, setMode] = useState<BillingMode>(initialMode);
  const [saving, setSaving] = useState<BillingMode | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function select(next: BillingMode) {
    if (next === mode || saving) return;
    setError("");
    setSaved(false);
    setSaving(next);
    try {
      const res = await fetch("/api/v1/account/billing-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({ mode: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        return;
      }
      setMode(next);
      setSaved(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="glass-card shimmer-line p-6">
      <div className="flex items-center gap-2 mb-1">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </svg>
        <h3 className="text-lg font-semibold text-white/90">Billing mode</h3>
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-5">
        How premium models are charged. Applies to your whole account, and takes effect on your next
        request.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => {
          const active = mode === m.id;
          const busy = saving === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => select(m.id)}
              disabled={!!saving}
              aria-pressed={active}
              className={`text-left rounded-xl border p-4 transition ${
                active
                  ? "border-[var(--aurora-violet)] bg-white/[0.06]"
                  : "border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
              } ${saving ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-white/90">{m.title}</span>
                {active && (
                  <span className="text-[11px] uppercase tracking-wide text-[var(--aurora-violet)]">
                    {busy ? "Saving…" : "Active"}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{m.tagline}</p>
              <ul className="mt-3 space-y-1.5">
                {m.points.map((p) => (
                  <li key={p} className="text-xs text-white/60 flex gap-2">
                    <span className="text-[var(--aurora-violet)] opacity-70">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {mode === "payg" && (
        <p className="text-xs text-[var(--text-muted)] mt-4">
          Per-token prices are listed on the{" "}
          <a href="/dashboard/models" className="text-[var(--aurora-violet)] hover:underline">
            Models
          </a>{" "}
          page. You're billed on the tokens you actually send — never on anything a provider adds
          behind the scenes.
        </p>
      )}

      {error && <p className="text-xs text-red-400 mt-4">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-400 mt-4">Billing mode updated.</p>}
    </div>
  );
}
