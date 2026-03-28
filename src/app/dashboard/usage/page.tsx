import { createServerSupabase } from "@/lib/supabase/server";

export default async function UsagePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: logs } = await supabase
    .from("usage_logs")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  // Calculate totals
  const totalCredits = (logs || []).reduce((sum, l) => sum + l.credits_charged, 0);
  const totalTokens = (logs || []).reduce((sum, l) => sum + l.total_tokens, 0);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Usage History</h2>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-sm text-[var(--text-muted)]">Total Requests</p>
          <p className="text-2xl font-bold mt-1">{(logs || []).length}</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-sm text-[var(--text-muted)]">Total Tokens</p>
          <p className="text-2xl font-bold mt-1">{totalTokens.toLocaleString()}</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-sm text-[var(--text-muted)]">Total Credits Used</p>
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
          <div className="p-8 text-center text-[var(--text-muted)]">
            <p>No usage data yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
