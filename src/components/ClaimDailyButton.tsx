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

    const res = await fetch("/api/v1/billing/claim-daily", { method: "POST", headers: { "X-Requested-With": "AetherRouter" } });
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
        className={`font-medium rounded-xl px-5 py-2.5 text-sm transition-all ${
          claimed
            ? "text-[var(--text-dim)] cursor-not-allowed"
            : "btn-aurora hover:scale-[1.02]"
        }`}
        style={claimed ? {
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        } : {}}
      >
        {loading
          ? "Claiming..."
          : claimed
          ? "Claimed today"
          : `Claim ${creditsPerDay.toLocaleString()} daily credits`}
      </button>
      {message && (
        <span className={`text-sm font-medium ${claimed ? "text-teal-400" : "text-red-400/80"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
