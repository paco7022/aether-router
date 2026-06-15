import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EnterpriseBuyCard } from "@/components/EnterpriseBuyCard";

// credits = tokens/1M * rate * CREDITS_PER_USD(10000) → tokens = credits * 100 / rate
function creditsToTokens(credits: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.floor((credits * 100) / rate);
}
const fmt = (n: number) => n.toLocaleString();

export default async function EnterprisePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  const { data: keys } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, custom_credits, flat_cost_per_m_tokens, expires_at, last_used, is_active")
    .eq("user_id", user!.id)
    .eq("is_custom", true)
    .eq("pricing_mode", "flat_per_token")
    .order("created_at", { ascending: false });

  const enterpriseKeys = keys || [];

  // 7-day usage for these keys (visible tokens = estimated prompt + completion).
  const keyIds = enterpriseKeys.map((k) => k.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const usageByKey = new Map<string, { tokens7d: number; credits7d: number }>();
  if (keyIds.length > 0) {
    const { data: logs } = await admin
      .from("usage_logs")
      .select("api_key_id, estimated_prompt_tokens, completion_tokens, credits_charged")
      .in("api_key_id", keyIds)
      .gte("created_at", sevenDaysAgo);
    for (const l of logs || []) {
      const cur = usageByKey.get(l.api_key_id) || { tokens7d: 0, credits7d: 0 };
      cur.tokens7d += (l.estimated_prompt_tokens ?? 0) + (l.completion_tokens ?? 0);
      cur.credits7d += l.credits_charged ?? 0;
      usageByKey.set(l.api_key_id, cur);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Enterprise</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          High-volume prepaid access to <span className="text-[var(--aurora-violet)]">or/</span> models — pay-as-you-go per token, no rate limits, native context windows.
        </p>
      </div>

      {enterpriseKeys.length === 0 ? (
        /* Pitch — no enterprise key provisioned yet */
        <div className="glass-card aurora-border shimmer-line p-8 max-w-2xl">
          <h3 className="text-lg font-bold text-white/90 mb-3">Aether Enterprise</h3>
          <ul className="space-y-2 text-sm text-white/75 mb-6">
            <li>• <span className="font-medium text-white/90">$3 / million tokens</span> — billed on visible tokens (prompt + completion).</li>
            <li>• <span className="font-medium text-white/90">or/</span> models: Claude (Opus/Sonnet), DeepSeek, GLM, Minimax.</li>
            <li>• Native context windows (200k, and 1M on Opus 4.8). No RPM limits.</li>
            <li>• Prepaid, no expiry. Minimum first purchase: 100M tokens ($300).</li>
          </ul>
          <p className="text-sm text-[var(--text-muted)]">
            Contact us to get your enterprise key provisioned, then top up tokens here anytime.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {enterpriseKeys.map((k) => {
            const rate = Number(k.flat_cost_per_m_tokens) || 3;
            const balanceCredits = k.custom_credits ?? 0;
            const balanceTokens = creditsToTokens(balanceCredits, rate);
            const usage = usageByKey.get(k.id) || { tokens7d: 0, credits7d: 0 };
            const expired = k.expires_at && new Date(k.expires_at) < new Date();
            const low = balanceTokens > 0 && balanceTokens < 50_000_000;
            return (
              <div key={k.id} className="glass-card aurora-border shimmer-line p-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-bold text-white/90">{k.name || "Enterprise key"}</p>
                    <p className="text-xs font-mono text-cyan-300/60 mt-0.5">{k.key_prefix}…</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!k.is_active && <span className="badge-error px-2.5 py-0.5 rounded-full text-[11px] font-medium">disabled</span>}
                    {expired && <span className="badge-error px-2.5 py-0.5 rounded-full text-[11px] font-medium">expired</span>}
                    {low && !expired && k.is_active && <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium" style={{ background: "rgba(251,191,36,0.12)", color: "rgb(251,191,36)" }}>low balance</span>}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <Stat label="Tokens left" value={fmt(balanceTokens)} />
                  <Stat label="Balance (USD)" value={`$${(balanceCredits / 10_000).toFixed(2)}`} accent />
                  <Stat label="Tokens used (7d)" value={fmt(usage.tokens7d)} />
                  <Stat label="Spent (7d)" value={`$${(usage.credits7d / 10_000).toFixed(2)}`} />
                </div>

                <EnterpriseBuyCard keyId={k.id} rate={rate} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-lg font-bold tracking-tight mt-1 ${accent ? "text-emerald-300/90" : "text-white/90"}`}>{value}</p>
    </div>
  );
}
