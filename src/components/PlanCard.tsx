"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Plan {
  id: string;
  name: string;
  description: string;
  price_usd: number;
  credits_per_day: number;
  credits_per_month: number;
  bonus_pct: number;
  is_popular: boolean;
}

export function PlanCard({
  plan,
  isCurrent,
}: {
  plan: Plan;
  isCurrent: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const bonusLabel =
    plan.bonus_pct > 0 ? `${plan.bonus_pct}% more value vs buying` : "";

  async function handleSubscribe() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative bg-[var(--bg-card)] border rounded-xl p-5 flex flex-col ${
        plan.is_popular
          ? "border-teal-500/60 shadow-lg shadow-teal-500/10"
          : "border-[var(--border)]"
      }`}
    >
      {plan.is_popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
          Popular
        </span>
      )}

      <div className="mb-4">
        <h4 className="text-lg font-bold">{plan.name}</h4>
        <p className="text-xs text-[var(--text-muted)]">{plan.description}</p>
      </div>

      <div className="mb-4">
        {plan.price_usd > 0 ? (
          <p className="text-3xl font-bold">
            ${plan.price_usd}
            <span className="text-base font-normal text-[var(--text-muted)]">
              /mo
            </span>
          </p>
        ) : (
          <p className="text-3xl font-bold">Free</p>
        )}
      </div>

      <div className="mb-4 space-y-1 text-sm">
        <p>
          <span className="font-semibold">
            {plan.credits_per_day.toLocaleString()}
          </span>{" "}
          <span className="text-[var(--text-muted)]">credits/day</span>
        </p>
        <p>
          <span className="text-[var(--text-muted)]">~</span>
          <span className="font-semibold">
            {(plan.credits_per_month / 1000).toFixed(0)}K
          </span>{" "}
          <span className="text-[var(--text-muted)]">credits/month</span>
        </p>
        {bonusLabel && (
          <p className="text-teal-400 text-xs mt-1">{bonusLabel}</p>
        )}
      </div>

      <div className="mt-auto">
        {isCurrent ? (
          <div className="w-full py-2 px-4 rounded-lg bg-[var(--bg-hover)] text-center text-sm text-[var(--text-muted)]">
            Current Plan
          </div>
        ) : (
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              plan.is_popular
                ? "bg-teal-500 hover:bg-teal-400 text-white"
                : "bg-[var(--bg-hover)] hover:bg-[var(--accent)] hover:text-white text-[var(--text)]"
            }`}
          >
            {loading ? "..." : "Subscribe"}
          </button>
        )}
      </div>
    </div>
  );
}
