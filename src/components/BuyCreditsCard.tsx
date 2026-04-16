"use client";

import { useState } from "react";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_usd: number;
}

export function BuyCreditsCard({ pkg }: { pkg: CreditPackage }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleBuy() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/billing/buy-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({ package_id: pkg.id }),
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
    <div className="glass-card aurora-border p-5 transition-all duration-300 hover:scale-[1.01]">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-white/85">{pkg.name}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            ${pkg.price_usd} USD -- permanent, no expiry
          </p>
        </div>
        <button
          onClick={handleBuy}
          disabled={loading}
          className="px-4 py-2 rounded-xl text-white text-sm font-medium btn-teal disabled:opacity-50"
        >
          {loading ? "..." : "Buy"}
        </button>
      </div>
      {error && (
        <p className="text-red-400/80 text-xs mt-2">{error}</p>
      )}
    </div>
  );
}
