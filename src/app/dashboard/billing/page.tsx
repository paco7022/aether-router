import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BuyCreditsCard } from "@/components/BuyCreditsCard";
import { ClaimDailyButton } from "@/components/ClaimDailyButton";
import { GmRequestsCard } from "@/components/GmRequestsCard";
import { CheckoutFeedback } from "@/components/CheckoutFeedback";

export default async function BillingPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Plan subscriptions are no longer offered — `plans` query intentionally
  // dropped. Existing subscriptions keep flowing through the `subscription`
  // query so the badge / claim button still work for current subscribers.
  const [
    { data: profile },
    { data: subscription },
    { data: packages },
    { data: transactions },
  ] = await Promise.all([
    supabase.from("profiles").select("credits, daily_credits, plan_id, gm_claimed_date").eq("id", user!.id).single(),
    supabase
      .from("subscriptions")
      .select("*, plans(*)")
      .eq("user_id", user!.id)
      .eq("status", "active")
      .single(),
    supabase.from("credit_packages").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const admin = createAdminClient();

  // Read the same counter that `reserve_premium_request` enforces against,
  // not a re-sum of usage_logs. Re-summing missed h/ and gm/ premium
  // providers (the filter only included t/, an/, w/), so the bar showed
  // less than the API actually counted and users hit "daily limit reached"
  // while the page still read e.g. 51%.
  const [{ data: premiumCounters }, { data: currentPlan }] = await Promise.all([
    admin
      .from("profiles")
      .select("premium_requests_today, premium_requests_date, premium_request_debt")
      .eq("id", user!.id)
      .single(),
    admin
      .from("plans")
      .select("gm_daily_requests, gm_max_context")
      .eq("id", profile?.plan_id || "free")
      .single(),
  ]);
  const todayUtc = new Date().toISOString().split("T")[0];
  const premiumUsedToday = premiumCounters?.premium_requests_date === todayUtc
    ? Number(premiumCounters?.premium_requests_today ?? 0)
    : 0;
  const premiumDebt = Number(premiumCounters?.premium_request_debt ?? 0);

  const permanentCredits = profile?.credits || 0;
  const dailyCredits = profile?.daily_credits || 0;
  const totalCredits = permanentCredits + dailyCredits;
  const gmClaimedToday = profile?.gm_claimed_date === new Date().toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  const alreadyClaimed = subscription?.last_grant_date === today;
  const planObj = subscription?.plans as { credits_per_day: number } | null;
  const creditsPerDay = planObj?.credits_per_day || 0;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Billing</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Manage your credits, plans, and purchases</p>
      </div>

      <Suspense>
        <CheckoutFeedback />
      </Suspense>

      {/* Current balance */}
      <div className="glass-card-elevated aurora-border shimmer-line p-6 mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Total Balance</p>
            </div>
            <p className="text-4xl font-bold aurora-text tracking-tight">
              {totalCredits.toLocaleString()}
            </p>
            <p className="text-sm text-[var(--text-muted)] mt-1">credits</p>
            <div className="flex gap-5 mt-3">
              <div>
                <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Daily</p>
                <p className="text-sm font-semibold text-teal-400">{dailyCredits.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Permanent</p>
                <p className="text-sm font-semibold text-emerald-400">{permanentCredits.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-[var(--text-dim)] mb-1">10,000 credits = $1.00 USD</p>
            <p className="text-xs text-[var(--text-dim)] mb-2">Daily credits are used first and reset each day</p>
            {subscription?.plans && (
              <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium badge-violet">
                {(subscription.plans as { name: string }).name}
              </div>
            )}
          </div>
        </div>
        {creditsPerDay > 0 && (
          <div className="mt-5 pt-4 border-t border-white/[0.04]">
            <ClaimDailyButton alreadyClaimed={alreadyClaimed} creditsPerDay={creditsPerDay} />
          </div>
        )}
      </div>

      {/* GM Requests */}
      <div className="mb-8">
        <GmRequestsCard
          used={premiumUsedToday}
          limit={currentPlan?.gm_daily_requests ?? 15}
          debt={premiumDebt}
          claimed={gmClaimedToday}
        />
      </div>

      {/* Plans section removed: subscriptions disabled, migrating to pay-as-you-go. */}

      {/* Buy Credits */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-teal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <h3 className="text-xl font-bold text-white/90">Buy Credits</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          One-time purchase. $1 = 10,000 permanent credits. These never expire.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {packages?.map((pkg) => (
            <BuyCreditsCard key={pkg.id} pkg={pkg} />
          ))}
        </div>
      </div>

      {/* Transaction history */}
      <div className="glass-card shimmer-line overflow-hidden">
        <div className="p-5 border-b border-white/[0.04] flex items-center justify-between">
          <h3 className="font-semibold text-white/85">Transaction History</h3>
          <span className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Last 50</span>
        </div>

        {transactions && transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm aurora-table">
              <thead>
                <tr className="text-[var(--text-muted)] text-left">
                  <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Type</th>
                  <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Description</th>
                  <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Amount</th>
                  <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap text-xs">
                      {new Date(tx.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          tx.type === "usage"
                            ? "badge-success"
                            : tx.type === "purchase"
                            ? "badge-success"
                            : tx.type === "daily_grant"
                            ? "badge-teal"
                            : tx.type === "admin_grant"
                            ? "badge-violet"
                            : "text-zinc-400 bg-zinc-400/10 border border-zinc-400/15"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">
                      {tx.description || "-"}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold ${
                        tx.amount > 0 ? "text-emerald-400" : "text-red-400/80"
                      }`}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {tx.amount.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right text-[var(--text-muted)]">
                      {tx.balance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-[var(--text-dim)]">
            <p>No transactions yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
