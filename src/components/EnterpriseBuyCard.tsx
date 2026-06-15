"use client";

import { useState } from "react";

const MIN_TOKENS = 100_000_000;

// Prepaid token top-up for an enterprise (flat_per_token) key. Price = tokens × rate.
export function EnterpriseBuyCard({
  keyId,
  rate,
}: {
  keyId: string;
  rate: number;
}) {
  const [millions, setMillions] = useState(100); // default 100M
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const tokens = Math.round(millions * 1_000_000);
  const usd = (tokens / 1_000_000) * rate;
  const belowMin = tokens < MIN_TOKENS;

  async function handleBuy() {
    if (belowMin) {
      setError(`Minimum is ${(MIN_TOKENS / 1_000_000).toLocaleString()}M tokens.`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/billing/buy-enterprise-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({ key_id: keyId, tokens }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Something went wrong");
        setLoading(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/5">
      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">Top up tokens</p>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={100}
            step={50}
            value={millions}
            onChange={(e) => setMillions(Math.max(0, Number(e.target.value)))}
            className="w-28 px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white/90 text-sm focus:outline-none focus:border-[var(--aurora-violet)]"
          />
          <span className="text-sm text-[var(--text-muted)]">M tokens</span>
        </div>
        <span className="text-sm text-white/70">
          = <span className="font-semibold text-emerald-300/90">${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-[var(--text-dim)]"> (${rate}/M)</span>
        </span>
        <button
          onClick={handleBuy}
          disabled={loading || belowMin}
          className="px-4 py-2 rounded-xl text-white text-sm font-medium btn-teal disabled:opacity-50 ml-auto"
        >
          {loading ? "..." : "Buy"}
        </button>
      </div>
      {belowMin && <p className="text-amber-400/70 text-xs mt-2">Minimum {(MIN_TOKENS / 1_000_000).toLocaleString()}M tokens.</p>}
      {error && <p className="text-red-400/80 text-xs mt-2">{error}</p>}
    </div>
  );
}
