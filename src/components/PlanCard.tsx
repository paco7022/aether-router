"use client";

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
  gm_daily_requests: number;
  gm_max_context: number;
}

export function PlanCard({
  plan,
  isCurrent,
}: {
  plan: Plan;
  isCurrent: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");


  async function handleSubscribe() {
    if (plan.price_usd <= 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id }),
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
    <div
      className={`relative glass-card p-5 flex flex-col ${
        plan.is_popular
          ? "aurora-border"
          : ""
      }`}
      style={plan.is_popular ? {
        boxShadow: "0 0 30px -8px rgba(20, 184, 166, 0.15)",
        borderColor: "rgba(20, 184, 166, 0.25)",
      } : {}}
    >
      {plan.is_popular && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider"
          style={{
            background: "linear-gradient(135deg, #14b8a6, #22d3ee)",
          }}
        >
          Popular
        </span>
      )}

      <div className="mb-4">
        <h4 className="text-lg font-bold text-white/90">{plan.name}</h4>
        <p className="text-xs text-[var(--text-muted)]">{plan.description}</p>
      </div>

      <div className="mb-4">
        {plan.price_usd > 0 ? (
          <p className="text-3xl font-bold text-white/90">
            ${plan.price_usd}
            <span className="text-base font-normal text-[var(--text-muted)]">
              /mo
            </span>
          </p>
        ) : (
          <p className="text-3xl font-bold text-white/90">Free</p>
        )}
      </div>

      <div className="mb-4 space-y-1 text-sm">
        <p>
          <span className="font-semibold text-white/85">
            {plan.credits_per_day > 0
              ? `${plan.credits_per_day.toLocaleString()}`
              : "Unlimited"}
          </span>{" "}
          <span className="text-[var(--text-muted)]">credits/day</span>
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          1 credit = 1 request
        </p>
      </div>

      {/* Deepseek free pool */}
      <div className="mb-4 pt-3 border-t border-white/[0.04]">
        <p className="text-xs font-semibold text-emerald-400/80 mb-1.5">
          Deepseek v3.2 (free)
        </p>
        <div className="space-y-0.5 text-xs text-[var(--text-muted)]">
          <p>200k tokens/day</p>
        </div>
      </div>

      {/* Premium model limits */}
      <div className="mb-4 pt-3 border-t border-white/[0.04]">
        {plan.id === "free" ? (
          <>
            <p className="text-xs font-semibold text-cyan-400/80 mb-1.5">
              Premium Models (t/, w/)
            </p>
            <div className="space-y-0.5 text-xs text-[var(--text-muted)]">
              <p>
                {plan.gm_daily_requests > 0
                  ? `${plan.gm_daily_requests} requests/day`
                  : "Unlimited requests"}
              </p>
              <p>
                {plan.gm_max_context > 0
                  ? `${(plan.gm_max_context / 1024).toFixed(0)}k context`
                  : "Unlimited context"}
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-violet-400/80 mb-1.5">
              Premium Models (t/, w/, an/)
            </p>
            <div className="space-y-0.5 text-xs text-[var(--text-muted)]">
              <p>
                {plan.gm_daily_requests > 0
                  ? `${plan.gm_daily_requests} requests/day`
                  : "Unlimited requests"}
              </p>
              <p>
                {plan.gm_max_context > 0
                  ? `${(plan.gm_max_context / 1024).toFixed(0)}k context`
                  : "Unlimited context"}
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="text-red-400/80 text-xs mb-2">{error}</p>
      )}

      <div className="mt-auto">
        {isCurrent ? (
          <div className="w-full py-2.5 px-4 rounded-xl text-center text-sm text-[var(--text-dim)]"
            style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            Current Plan
          </div>
        ) : plan.price_usd > 0 ? (
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 cursor-pointer"
            style={{
              background: "linear-gradient(135deg, #14b8a6, #22d3ee)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "0 0 24px -4px rgba(20, 184, 166, 0.4)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.transform = "none";
            }}
          >
            {loading ? "Redirecting..." : "Subscribe"}
          </button>
        ) : (
          <div className="w-full py-2.5 px-4 rounded-xl text-center text-sm text-[var(--text-dim)]"
            style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
            Free Tier
          </div>
        )}
      </div>
    </div>
  );
}
