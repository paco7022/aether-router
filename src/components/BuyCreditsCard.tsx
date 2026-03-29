"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_usd: number;
}

export function BuyCreditsCard({ pkg }: { pkg: CreditPackage }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleBuy() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/billing/buy-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: pkg.id }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 flex items-center justify-between">
      <div>
        <p className="font-bold">{pkg.name}</p>
        <p className="text-xs text-[var(--text-muted)]">
          ${pkg.price_usd} USD — permanent, no expiry
        </p>
      </div>
      <button
        onClick={handleBuy}
        disabled={loading}
        className="px-4 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--accent)] hover:text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
      >
        {loading ? "..." : "Buy"}
      </button>
    </div>
  );
}
