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
      <h2 className="text-2xl font-bold mb-6">Usage History</h2>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 hover:border-blue-500/30 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">Total Requests</p>
            <span className="text-lg font-mono text-blue-400/50">=</span>
          </div>
          <p className="text-2xl font-bold mt-1">{(totalRequests ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 hover:border-cyan-500/30 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">Total Tokens</p>
            <span className="text-lg font-mono text-cyan-400/50">&gt;</span>
          </div>
          <p className="text-2xl font-bold mt-1">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 hover:border-green-500/30 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">Total Credits Used</p>
            <span className="text-lg font-mono text-green-400/50">$</span>
          </div>
          <p className="text-2xl font-bold mt-1">{totalCredits.toLocaleString()}</p>
          <p className="text-xs text-[var(--text-muted)]">${(totalCredits / 10_000).toFixed(2)} USD</p>
        </div>
      </div>

      {/* Usage table */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)] text-left border-b border-[var(--border)]">
              <th className="px-5 py-3 font-medium">Timestamp</th>
              <th className="px-5 py-3 font-medium">Model</th>
              <th className="px-5 py-3 font-medium text-right">Prompt</th>
              <th className="px-5 py-3 font-medium text-right">Completion</th>
              <th className="px-5 py-3 font-medium text-right">Total</th>
              <th className="px-5 py-3 font-medium text-right">Credits</th>
              <th className="px-5 py-3 font-medium text-right">Latency</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(logs || []).map((log) => (
              <tr key={log.id} className="border-t border-[var(--border)]">
                <td className="px-5 py-3 text-[var(--text-muted)] whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="px-5 py-3 font-mono text-xs">{log.model_id}</td>
                <td className="px-5 py-3 text-right">{log.prompt_tokens.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{log.completion_tokens.toLocaleString()}</td>
                <td className="px-5 py-3 text-right font-medium">{log.total_tokens.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">{log.credits_charged.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-[var(--text-muted)]">
                  {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : "-"}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                      log.status === "success"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {log.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(!logs || logs.length === 0) && (
          <div className="p-12 text-center">
            <p className="text-4xl mb-3 opacity-30 font-mono">=</p>
            <p className="text-sm font-medium mb-1">No usage data yet</p>
            <p className="text-xs text-[var(--text-muted)]">Your API request history will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
