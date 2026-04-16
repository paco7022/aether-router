import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsagePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  const { count: totalRequests } = await admin
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user!.id);

  const { data: totals } = await admin.rpc("get_usage_totals", {
    p_user_id: user!.id,
  });

  const totalCredits = totals?.total_credits ?? 0;
  const totalTokens = totals?.total_tokens ?? 0;

  const { data: logs } = await admin
    .from("usage_logs")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Usage History</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Track your API consumption</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <div className="glass-card aurora-border shimmer-line p-5 glow-blue">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Total Requests</p>
            <div className="stat-icon"
              style={{ background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.12)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(59, 130, 246, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-white/90 tracking-tight">{(totalRequests ?? 0).toLocaleString()}</p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-5 glow-cyan">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Total Tokens</p>
            <div className="stat-icon"
              style={{ background: "rgba(34, 211, 238, 0.1)", border: "1px solid rgba(34, 211, 238, 0.12)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(34, 211, 238, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-white/90 tracking-tight">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-5 glow-green">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">Total Credits Used</p>
            <div className="stat-icon"
              style={{ background: "rgba(52, 211, 153, 0.1)", border: "1px solid rgba(52, 211, 153, 0.12)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(52, 211, 153, 0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-white/90 tracking-tight">{totalCredits.toLocaleString()}</p>
          <p className="text-xs text-emerald-400/60 mt-1.5 font-medium">${(totalCredits / 10_000).toFixed(2)} USD</p>
        </div>
      </div>

      {/* Usage table */}
      <div className="glass-card shimmer-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm aurora-table">
            <thead>
              <tr className="text-[var(--text-muted)] text-left">
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Timestamp</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Model</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Prompt</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Completion</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Total</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Credits</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Latency</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {(logs || []).map((log) => (
                <tr key={log.id}>
                  <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap text-xs">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-cyan-300/70">{log.model_id}</td>
                  <td className="px-5 py-3 text-right text-white/70">{log.prompt_tokens.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-white/70">{log.completion_tokens.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-medium text-white/85">{log.total_tokens.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-white/70">{log.credits_charged.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-[var(--text-muted)]">
                    {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : "-"}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                      log.status === "success" ? "badge-success" : "badge-error"
                    }`}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(!logs || logs.length === 0) && (
          <div className="p-16 text-center">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.08))",
                border: "1px solid rgba(139, 92, 246, 0.1)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white/60 mb-1">No usage data yet</p>
            <p className="text-xs text-[var(--text-dim)] max-w-xs mx-auto">Your API request history will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
