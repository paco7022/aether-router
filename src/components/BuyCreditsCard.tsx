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
        headers: { "Content-Type": "application/json" },
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
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold">{pkg.name}</p>
          <p className="text-xs text-[var(--text-muted)]">
            ${pkg.price_usd} USD — permanent, no expiry
          </p>
        </div>
        <button
        onClick={handleBuy}
        disabled={loading}
        className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
      >
          {loading ? "..." : "Buy"}
        </button>
      </div>
      {error && (
        <p className="text-red-400 text-xs mt-2">{error}</p>
      )}
    </div>
  );
}
