import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReferralLinkCard } from "@/components/ReferralLinkCard";

export default async function ReferralsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("referral_code, referral_bonus_requests, referral_bonus_expires")
    .eq("id", user!.id)
    .single();

  const admin = createAdminClient();
  const { data: referrals } = await admin
    .from("referrals")
    .select("id, referee_id, status, created_at, profiles:referee_id(email)")
    .eq("referrer_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const validReferrals = (referrals ?? []).filter((r) => r.status === "valid");
  const rejectedCount = (referrals ?? []).length - validReferrals.length;

  const code = profile?.referral_code ?? "";
  const bonus = profile?.referral_bonus_requests ?? 0;
  const expires = profile?.referral_bonus_expires
    ? new Date(profile.referral_bonus_expires)
    : null;
  const bonusActive = expires !== null && expires > new Date();
  const hoursLeft = bonusActive && expires
    ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 3_600_000))
    : 0;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Referrals</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Invite real humans. Get +10 premium requests/day for 3 days — for you AND them.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="glass-card shimmer-line p-5">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-3">
            Valid invites
          </p>
          <p className="text-3xl font-bold text-white/90">{validReferrals.length}</p>
          {rejectedCount > 0 && (
            <p className="text-[11px] text-[var(--text-dim)] mt-1.5">
              {rejectedCount} rejected (same device / IP)
            </p>
          )}
        </div>

        <div className="glass-card shimmer-line p-5">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-3">
            Active bonus
          </p>
          {bonusActive ? (
            <>
              <p className="text-3xl font-bold aurora-text">+{bonus}/day</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                {hoursLeft} hour{hoursLeft === 1 ? "" : "s"} remaining
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-white/40">+0/day</p>
              <p className="text-[11px] text-[var(--text-dim)] mt-1.5">
                Invite someone to activate
              </p>
            </>
          )}
        </div>

        <div className="glass-card shimmer-line p-5">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-3">
            Window
          </p>
          <p className="text-3xl font-bold text-white/90">3 days</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            Each valid invite resets and stacks the bonus
          </p>
        </div>
      </div>

      <ReferralLinkCard code={code} />

      <div className="glass-card shimmer-line p-5 mt-6">
        <h3 className="font-semibold text-sm text-white/85 mb-3">How it works</h3>
        <ul className="text-sm text-[var(--text-muted)] space-y-2 leading-relaxed">
          <li>• Share your link. When a friend signs up through it, you both get <span className="text-white/80">+10 premium requests/day for 3 days</span>.</li>
          <li>• Bonuses <span className="text-white/80">stack</span>: invite 3 real friends = +30/day.</li>
          <li>• We reject invites from the <span className="text-white/80">same device or IP</span> — only real humans count.</li>
          <li>• The 3-day window resets on every new valid invite.</li>
        </ul>
      </div>

      {validReferrals.length > 0 && (
        <div className="glass-card shimmer-line p-5 mt-6">
          <h3 className="font-semibold text-sm text-white/85 mb-3">Recent invites</h3>
          <div className="divide-y divide-white/[0.04]">
            {validReferrals.map((r) => {
              const email = (r.profiles as unknown as { email: string } | null)?.email ?? "unknown";
              const masked = email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
              return (
                <div key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-white/80">{masked}</span>
                  <span className="text-[11px] text-[var(--text-dim)]">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
