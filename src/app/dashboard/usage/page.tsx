import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsagePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  // Get accurate totals from DB using admin client (bypasses RLS)
  const { count: totalRequests } = await admin
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user!.id);

  const { data: totals } = await admin.rpc("get_usage_totals", {
    p_user_id: user!.id,
  });

  const totalCredits = totals?.total_credits ?? 0;
  const totalTokens = totals?.total_tokens ?? 0;

  // Get recent logs for the table
  const { data: logs } = await admin
    .from("usage_logs")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90">Usage History</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Track your API consumption</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <div className="glass-card aurora-border shimmer-line p-5 glow-blue">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Total Requests</p>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.12)" }}>
              <span className="text-blue-400/70 text-sm font-mono">=</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-white/90">{(totalRequests ?? 0).toLocaleString()}</p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-5 glow-cyan">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Total Tokens</p>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(34, 211, 238, 0.1)", border: "1px solid rgba(34, 211, 238, 0.12)" }}>
              <span className="text-cyan-400/70 text-sm font-mono">&gt;</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-white/90">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-5 glow-green">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Total Credits Used</p>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(52, 211, 153, 0.1)", border: "1px solid rgba(52, 211, 153, 0.12)" }}>
              <span className="text-emerald-400/70 text-sm font-mono">$</span>
            </div>
          </div>
          <p className="text-2xl font-bold text-white/90">{totalCredits.toLocaleString()}</p>
          <p className="text-xs text-emerald-400/60 mt-1">${(totalCredits / 10_000).toFixed(2)} USD</p>
        </div>
      </div>

      {/* Usage table */}
      <div className="glass-card shimmer-line overflow-hidden">
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
                <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap">
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
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                    log.status === "success" ? "badge-success" : "badge-error"
                  }`}>
                    {log.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(!logs || logs.length === 0) && (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.08))",
                border: "1px solid rgba(139, 92, 246, 0.1)",
              }}
            >
              <span className="text-[var(--text-dim)] text-lg font-mono">=</span>
            </div>
            <p className="text-sm font-medium text-white/60 mb-1">No usage data yet</p>
            <p className="text-xs text-[var(--text-dim)]">Your API request history will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
