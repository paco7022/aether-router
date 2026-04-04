import { createServerSupabase } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", user!.id)
    .single();

  const { data: recentUsage } = await supabase
    .from("usage_logs")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const { count: totalRequests } = await supabase
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user!.id);

  const { data: keyCount } = await supabase
    .from("api_keys")
    .select("id")
    .eq("user_id", user!.id)
    .eq("is_active", true);

  const credits = profile?.credits || 0;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white/90">Overview</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Your dashboard at a glance</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {/* Credits */}
        <div className="glass-card aurora-border shimmer-line p-5 glow-green">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Credits Balance</p>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "rgba(52, 211, 153, 0.1)",
                border: "1px solid rgba(52, 211, 153, 0.12)",
              }}
            >
              <span className="text-emerald-400/70 text-sm font-mono">$</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-white/90">{credits.toLocaleString()}</p>
          <p className="text-sm text-emerald-400/60 mt-1">${(credits / 10_000).toFixed(2)} USD</p>
        </div>

        {/* Total Requests */}
        <div className="glass-card aurora-border shimmer-line p-5 glow-blue">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Total Requests</p>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "rgba(59, 130, 246, 0.1)",
                border: "1px solid rgba(59, 130, 246, 0.12)",
              }}
            >
              <span className="text-blue-400/70 text-sm font-mono">=</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-white/90">{(totalRequests || 0).toLocaleString()}</p>
          <p className="text-sm text-blue-400/60 mt-1">lifetime</p>
        </div>

        {/* API Keys */}
        <div className="glass-card aurora-border shimmer-line p-5 glow-violet">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Active API Keys</p>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "rgba(139, 92, 246, 0.1)",
                border: "1px solid rgba(139, 92, 246, 0.12)",
              }}
            >
              <span className="text-violet-400/70 text-sm font-mono">#</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-white/90">{keyCount?.length || 0}</p>
          <p className="text-sm text-violet-400/60 mt-1">active</p>
        </div>
      </div>

      {/* Recent usage */}
      <div className="glass-card shimmer-line overflow-hidden">
        <div className="p-5 border-b border-white/[0.04]">
          <h3 className="font-semibold text-white/85">Recent Activity</h3>
        </div>
        {recentUsage && recentUsage.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm aurora-table">
              <thead>
                <tr className="text-[var(--text-muted)] text-left">
                  <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Model</th>
                  <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Tokens</th>
                  <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Credits</th>
                  <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentUsage.map((log) => (
                  <tr key={log.id}>
                    <td className="px-5 py-3 text-[var(--text-muted)]">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-cyan-300/70">{log.model_id}</td>
                    <td className="px-5 py-3 text-white/70">{log.total_tokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-white/70">{log.credits_charged.toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          log.status === "success"
                            ? "badge-success"
                            : "badge-error"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center">
            <div
              className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.08))",
                border: "1px solid rgba(139, 92, 246, 0.1)",
              }}
            >
              <span className="text-[var(--text-dim)] text-lg font-mono">~</span>
            </div>
            <p className="text-sm font-medium text-white/60 mb-1">No activity yet</p>
            <p className="text-xs text-[var(--text-dim)]">Create an API key and start making requests to see your usage here.</p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-[var(--text-dim)] mt-6">
        Aether Router is a proxy service. We do not control model availability, uptime, or output quality.
        Pricing includes a 55% margin over provider costs to maintain the service.
      </p>
    </div>
  );
}
