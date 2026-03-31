"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ClaimDailyButton({
  alreadyClaimed,
  creditsPerDay,
}: {
  alreadyClaimed: boolean;
  creditsPerDay: number;
}) {
  const [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(alreadyClaimed);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function handleClaim() {
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/v1/billing/claim-daily", { method: "POST" });
    const data = await res.json();

    if (res.ok) {
      setClaimed(true);
      setMessage(`+${creditsPerDay.toLocaleString()} daily credits claimed!`);
      router.refresh();
    } else {
      setMessage(data.error || "Failed to claim");
    }

    setLoading(false);
  }

  if (creditsPerDay <= 0) return null;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClaim}
        disabled={loading || claimed}
        className={`font-medium rounded-lg px-5 py-2.5 text-sm transition-all ${
          claimed
            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white hover:scale-105"
        }`}
      >
        {loading
          ? "Claiming..."
          : claimed
          ? "Claimed today"
          : `Claim ${creditsPerDay.toLocaleString()} daily credits`}
      </button>
      {message && (
        <span className={`text-sm font-medium ${claimed ? "text-teal-400" : "text-red-400"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
