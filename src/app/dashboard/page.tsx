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
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Overview</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Your dashboard at a glance</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {/* Credits */}
        <div className="glass-card aurora-border shimmer-line p-5 glow-green group">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Credits Balance</p>
            <div
              className="stat-icon"
              style={{
                background: "rgba(52, 211, 153, 0.1)",
                border: "1px solid rgba(52, 211, 153, 0.12)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(52, 211, 153, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-white/90 tracking-tight">{credits.toLocaleString()}</p>
          <p className="text-sm text-emerald-400/60 mt-1.5 font-medium">${(credits / 10_000).toFixed(2)} USD</p>
        </div>

        {/* Total Requests */}
        <div className="glass-card aurora-border shimmer-line p-5 glow-blue group">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Total Requests</p>
            <div
              className="stat-icon"
              style={{
                background: "rgba(59, 130, 246, 0.1)",
                border: "1px solid rgba(59, 130, 246, 0.12)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(59, 130, 246, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-white/90 tracking-tight">{(totalRequests || 0).toLocaleString()}</p>
          <p className="text-sm text-blue-400/60 mt-1.5 font-medium">lifetime</p>
        </div>

        {/* API Keys */}
        <div className="glass-card aurora-border shimmer-line p-5 glow-violet group">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Active API Keys</p>
            <div
              className="stat-icon"
              style={{
                background: "rgba(139, 92, 246, 0.1)",
                border: "1px solid rgba(139, 92, 246, 0.12)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(139, 92, 246, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-white/90 tracking-tight">{keyCount?.length || 0}</p>
          <p className="text-sm text-violet-400/60 mt-1.5 font-medium">active</p>
        </div>
      </div>

      {/* Recent usage */}
      <div className="glass-card shimmer-line overflow-hidden">
        <div className="p-5 border-b border-white/[0.04] flex items-center justify-between">
          <h3 className="font-semibold text-white/85">Recent Activity</h3>
          <span className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Last 10 requests</span>
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
                    <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap text-xs">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-cyan-300/70">{log.model_id}</td>
                    <td className="px-5 py-3 text-white/70">{log.total_tokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-white/70">{log.credits_charged.toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          log.status === "success"
                            ? "badge-success"
                            : "badge-error"
                        }`}
                      >
                        {log.status === "success" && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {log.status !== "success" && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        )}
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
              className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.08))",
                border: "1px solid rgba(139, 92, 246, 0.1)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white/60 mb-1">No activity yet</p>
            <p className="text-xs text-[var(--text-dim)] max-w-xs mx-auto">
              Create an API key and start making requests to see your usage here.
            </p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-[var(--text-dim)] mt-6 leading-relaxed">
        Aether Router is a proxy service. We do not control model availability, uptime, or output quality.
        Pricing includes a 55% margin over provider costs to maintain the service.
      </p>
    </div>
  );
}
