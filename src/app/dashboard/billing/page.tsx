import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlanCard } from "@/components/PlanCard";
import { BuyCreditsCard } from "@/components/BuyCreditsCard";
import { ClaimDailyButton } from "@/components/ClaimDailyButton";
import { GmRequestsCard } from "@/components/GmRequestsCard";
import { CheckoutFeedback } from "@/components/CheckoutFeedback";

export default async function BillingPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: subscription },
    { data: plans },
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
    supabase.from("plans").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("credit_packages").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Fetch gm/ usage for today and plan limits
  const admin = createAdminClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [{ count: gmUsedToday }, { data: currentPlan }] = await Promise.all([
    admin
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .like("model_id", "gm/%")
      .gte("created_at", todayStart.toISOString()),
    admin
      .from("plans")
      .select("gm_daily_requests, gm_max_context")
      .eq("id", profile?.plan_id || "free")
      .single(),
  ]);

  const permanentCredits = profile?.credits || 0;
  const dailyCredits = profile?.daily_credits || 0;
  const totalCredits = permanentCredits + dailyCredits;
  const currentPlanId = profile?.plan_id || "free";
  const gmClaimedToday = profile?.gm_claimed_date === new Date().toISOString().split("T")[0];
  const isFree = currentPlanId === "free";

  const today = new Date().toISOString().split("T")[0];
  const alreadyClaimed = subscription?.last_grant_date === today;
  const planObj = subscription?.plans as { credits_per_day: number } | null;
  const creditsPerDay = planObj?.credits_per_day || 0;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Billing</h2>

      <Suspense>
        <CheckoutFeedback />
      </Suspense>

      {/* Current balance */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--text-muted)]">Total Balance</p>
            <p className="text-4xl font-bold mt-1">
              {totalCredits.toLocaleString()}{" "}
              <span className="text-lg font-normal text-[var(--text-muted)]">credits</span>
            </p>
            <div className="flex gap-4 mt-2">
              <div>
                <p className="text-xs text-[var(--text-muted)]">Daily (temporary)</p>
                <p className="text-sm font-medium text-teal-400">{dailyCredits.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)]">Permanent</p>
                <p className="text-sm font-medium text-green-400">{permanentCredits.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--text-muted)] mb-1">10,000 credits = $1.00 USD</p>
            <p className="text-xs text-[var(--text-muted)] mb-2">Daily credits are used first and reset each day</p>
            {subscription?.plans && (
              <p className="text-sm">
                Current plan:{" "}
                <span className="font-semibold text-[var(--accent)]">
                  {(subscription.plans as { name: string }).name}
                </span>
              </p>
            )}
          </div>
        </div>
        {creditsPerDay > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <ClaimDailyButton alreadyClaimed={alreadyClaimed} creditsPerDay={creditsPerDay} />
          </div>
        )}
      </div>

      {/* GM Requests */}
      <div className="mb-8">
        <GmRequestsCard
          used={gmUsedToday ?? 0}
          limit={currentPlan?.gm_daily_requests ?? 20}
          claimed={gmClaimedToday}
          isFree={isFree}
        />
      </div>

      {/* Plans */}
      <div className="mb-8">
        <h3 className="text-xl font-bold mb-1">Plans</h3>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Subscribe monthly for daily temporary credits. They reset each day &mdash; use them or lose them. Higher plans = better value.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans?.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === currentPlanId}
            />
          ))}
        </div>
      </div>

      {/* Buy Credits */}
      <div className="mb-8">
        <h3 className="text-xl font-bold mb-1">Buy Credits</h3>
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
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold">Transaction History</h3>
        </div>

        {transactions && transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] text-left border-b border-[var(--border)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-[var(--border)]">
                    <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                          tx.type === "usage"
                            ? "bg-blue-500/10 text-blue-400"
                            : tx.type === "purchase"
                            ? "bg-green-500/10 text-green-400"
                            : tx.type === "daily_grant"
                            ? "bg-teal-500/10 text-teal-400"
                            : tx.type === "admin_grant"
                            ? "bg-purple-500/10 text-purple-400"
                            : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)]">
                      {tx.description || "-"}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-medium ${
                        tx.amount > 0 ? "text-green-400" : "text-red-400"
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
          <div className="p-8 text-center text-[var(--text-muted)]">
            <p>No transactions yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
