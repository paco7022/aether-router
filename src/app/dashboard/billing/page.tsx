import { Suspense } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlanCard } from "@/components/PlanCard";
import { BuyCreditsCard } from "@/components/BuyCreditsCard";
import { ClaimDailyButton } from "@/components/ClaimDailyButton";
import { GmRequestsCard } from "@/components/GmRequestsCard";
import { ContextBoostCard } from "@/components/ContextBoostCard";
import { TDiscountCard } from "@/components/TDiscountCard";
import { GiftCard } from "@/components/GiftCard";
import { CheckoutFeedback } from "@/components/CheckoutFeedback";
import { MIN_PAID_CREDITS } from "@/lib/free-tier";

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
    supabase.from("profiles").select("credits, daily_credits, plan_id, is_paid, billing_mode, gm_claimed_date, context_boost_expires_at, t_discount_expires_at, gm_daily_override, gm_override_expires, referral_bonus_requests, referral_bonus_expires").eq("id", user!.id).single(),
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

  const currentPlanId = profile?.plan_id || "free";
  // No plan = pay-as-you-go territory: access comes from purchased credits
  // (profiles.is_paid + the MIN_PAID_CREDITS floor), and the premium pool /
  // context-cap cards below simply don't apply.
  const noPlan = currentPlanId === "free";
  const isPayg = (profile as unknown as { is_paid?: boolean | null })?.is_paid === true;
  const paygActive = noPlan && isPayg;
  const permanentCredits = profile?.credits || 0;
  const dailyCredits = currentPlanId === "free" ? 0 : (profile?.daily_credits || 0);
  const totalCredits = permanentCredits + dailyCredits;
  const gmClaimedToday = profile?.gm_claimed_date === new Date().toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];
  const alreadyClaimed = subscription?.last_grant_date === today;
  const planObj = subscription?.plans as { credits_per_day: number } | null;
  const creditsPerDay = currentPlanId === "free" ? 0 : (planObj?.credits_per_day || 0);
  // Mirror the cap the API actually enforces in reserve_premium_request:
  //   baseGmDaily (or grandfathered override) + active referral bonus.
  // Without this the card showed `used / base` (e.g. 222/15) and ignored an
  // active +N/day bonus, so users with a bonus looked massively over-limit.
  type ProfileBonus = {
    gm_daily_override?: number | null;
    gm_override_expires?: string | null;
    referral_bonus_requests?: number | null;
    referral_bonus_expires?: string | null;
  };
  const profileBonus = (profile ?? {}) as ProfileBonus;
  const now = Date.now();
  const overrideActive =
    profileBonus.gm_daily_override != null &&
    !!profileBonus.gm_override_expires &&
    new Date(profileBonus.gm_override_expires).getTime() > now;
  // Free tier removed (2026-08-21): a legacy free account has no daily
  // premium allowance at all, so the bar reads 0 instead of the old 15.
  const baseGmDaily = overrideActive
    ? Number(profileBonus.gm_daily_override)
    : currentPlanId === "free"
    ? 0
    : (currentPlan?.gm_daily_requests ?? 15);
  const referralBonusActive =
    !!profileBonus.referral_bonus_expires &&
    new Date(profileBonus.referral_bonus_expires).getTime() > now;
  const referralBonus = referralBonusActive
    ? Number(profileBonus.referral_bonus_requests ?? 0)
    : 0;
  const premiumRequestLimit = baseGmDaily + referralBonus;

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

      {/* GM Requests — premium pool only exists inside a plan */}
      {!noPlan && (
      <div className="mb-8">
        <GmRequestsCard
          used={premiumUsedToday}
          limit={premiumRequestLimit}
          bonus={referralBonus}
          debt={premiumDebt}
          claimed={gmClaimedToday}
        />
      </div>
      )}

      {/* Context Boost — caps the premium pool, irrelevant on pay-as-you-go */}
      {!noPlan && (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-teal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
          <h3 className="text-xl font-bold text-white/90">Context Boost</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Temporarily or permanently double your context window for premium models.
        </p>
        <ContextBoostCard
          baseMaxContext={currentPlan?.gm_max_context ?? 32768}
          boostExpiresAt={(profile as unknown as { context_boost_expires_at?: string | null })?.context_boost_expires_at ?? null}
          totalCredits={totalCredits}
        />
        <div className="mt-4">
          <TDiscountCard
            discountExpiresAt={(profile as unknown as { t_discount_expires_at?: string | null })?.t_discount_expires_at ?? null}
            totalCredits={totalCredits}
          />
        </div>
      </div>
      )}

      {/* Pay-as-you-go status (accounts without a plan) */}
      {noPlan && (
        <div
          className="mb-8 rounded-xl px-5 py-4 text-sm"
          style={{
            background: paygActive
              ? "linear-gradient(135deg, rgba(52,211,153,0.08), rgba(34,211,238,0.04))"
              : "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(251,191,36,0.05))",
            border: paygActive ? "1px solid rgba(52,211,153,0.22)" : "1px solid rgba(239,68,68,0.25)",
            color: paygActive ? "rgba(167,243,208,0.95)" : "rgba(252,165,165,0.95)",
          }}
        >
          <p className="font-semibold mb-1">
            {paygActive ? "Pay as you go — active" : "No plan: routing is off"}
          </p>
          <p className="text-xs leading-relaxed opacity-90">
            {paygActive ? (
              <>
                You are billed per token against your permanent credits, with no daily premium pool
                and no context cap. Routing stops if your balance falls below{" "}
                {MIN_PAID_CREDITS.toLocaleString()} credits &mdash; you have{" "}
                <span className="font-semibold">{permanentCredits.toLocaleString()}</span>.
              </>
            ) : (
              <>
                The free tier was discontinued. Buy at least {MIN_PAID_CREDITS.toLocaleString()}{" "}
                credits to route pay-as-you-go (billed per token, no daily limits), or subscribe to a
                plan below for daily credits and a premium-request pool.
              </>
            )}
          </p>
        </div>
      )}

      {/* Plans */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <h3 className="text-xl font-bold text-white/90">Plans</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Subscribe monthly for daily temporary credits. They reset each day &mdash; use them or lose them.
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

      {/* Gift a friend */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
          <h3 className="text-xl font-bold text-white/90">Gift a Friend</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          Buy credits or a plan for someone else &mdash; just enter their email. Use your own email to extend or upgrade your plan.
        </p>
        <GiftCard packages={packages ?? []} plans={plans ?? []} />
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
                            : tx.type === "gift_received" || tx.type === "gift_plan"
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
