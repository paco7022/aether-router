"use client";

import { useState } from "react";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_usd: number;
}

interface Plan {
  id: string;
  name: string;
  price_usd: number;
  credits_per_day: number;
}

export function GiftCard({
  packages,
  plans,
}: {
  packages: CreditPackage[];
  plans: Plan[];
}) {
  const paidPlans = plans.filter((p) => p.id !== "free" && Number(p.price_usd) > 0);

  const [mode, setMode] = useState<"credits" | "plan">("credits");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [planId, setPlanId] = useState(paidPlans[0]?.id ?? "");
  const [months, setMonths] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedPlan = paidPlans.find((p) => p.id === planId);
  const planTotal = selectedPlan ? Number(selectedPlan.price_usd) * months : 0;

  async function handleSend() {
    setError("");
    if (!email.trim()) {
      setError("Enter your friend's email.");
      return;
    }
    setLoading(true);
    try {
      const payload =
        mode === "credits"
          ? { gift_type: "credits", package_id: packageId, recipient_email: email, message }
          : { gift_type: "plan", plan_id: planId, months, recipient_email: email, message };

      const res = await fetch("/api/v1/billing/gift", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "AetherRouter",
        },
        body: JSON.stringify(payload),
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
    <div className="glass-card aurora-border p-5">
      {/* Mode toggle */}
      <div className="inline-flex rounded-xl p-0.5 mb-5 bg-white/[0.03] border border-white/[0.05]">
        {(["credits", "plan"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === m
                ? "bg-white/[0.08] text-white/90"
                : "text-[var(--text-muted)] hover:text-white/70"
            }`}
          >
            {m === "credits" ? "Credits" : "Plan"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Left: what to gift */}
        <div>
          {mode === "credits" ? (
            <label className="block">
              <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                Package
              </span>
              <select
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white/90 focus:outline-none focus:border-white/20"
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id} className="bg-zinc-900">
                    {pkg.name} — ${pkg.price_usd} ({pkg.credits.toLocaleString()} cr)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                  Plan
                </span>
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white/90 focus:outline-none focus:border-white/20"
                >
                  {paidPlans.map((p) => (
                    <option key={p.id} value={p.id} className="bg-zinc-900">
                      {p.name} — ${p.price_usd}/mo
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                  Duration
                </span>
                <select
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="mt-1.5 w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white/90 focus:outline-none focus:border-white/20"
                >
                  {[1, 2, 3, 6, 12].map((m) => (
                    <option key={m} value={m} className="bg-zinc-900">
                      {m} month{m > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        {/* Right: recipient */}
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Friend&apos;s email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              className="mt-1.5 w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white/90 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-white/20"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Note (optional)
            </span>
            <input
              type="text"
              value={message}
              maxLength={280}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Happy birthday!"
              className="mt-1.5 w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white/90 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-white/20"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.04]">
        <p className="text-xs text-[var(--text-dim)]">
          {mode === "plan" && selectedPlan
            ? `Total $${planTotal.toFixed(2)} — ${months * 30} days of ${selectedPlan.name}`
            : "Applied instantly if they have an account; otherwise waits for signup."}
        </p>
        <button
          onClick={handleSend}
          disabled={loading}
          className="px-5 py-2 rounded-xl text-white text-sm font-medium btn-teal disabled:opacity-50"
        >
          {loading ? "..." : "Send gift"}
        </button>
      </div>
      {error && <p className="text-red-400/80 text-xs mt-2">{error}</p>}
    </div>
  );
}
