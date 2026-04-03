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
      <h2 className="text-2xl font-bold mb-6">Overview</h2>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 hover:border-green-500/30 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">Credits Balance</p>
            <span className="text-lg font-mono text-green-400/50">$</span>
          </div>
          <p className="text-3xl font-bold mt-1">{credits.toLocaleString()}</p>
          <p className="text-sm text-[var(--text-muted)]">${(credits / 10_000).toFixed(2)} USD</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 hover:border-blue-500/30 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">Total Requests</p>
            <span className="text-lg font-mono text-blue-400/50">=</span>
          </div>
          <p className="text-3xl font-bold mt-1">{(totalRequests || 0).toLocaleString()}</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 hover:border-purple-500/30 transition-colors">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">Active API Keys</p>
            <span className="text-lg font-mono text-purple-400/50">#</span>
          </div>
          <p className="text-3xl font-bold mt-1">{keyCount?.length || 0}</p>
        </div>
      </div>

      {/* Recent usage */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
        <div className="p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold">Recent Activity</h3>
        </div>
        {recentUsage && recentUsage.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] text-left">
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Model</th>
                  <th className="px-5 py-3 font-medium">Tokens</th>
                  <th className="px-5 py-3 font-medium">Credits</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentUsage.map((log) => (
                  <tr key={log.id} className="border-t border-[var(--border)]">
                    <td className="px-5 py-3 text-[var(--text-muted)]">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">{log.model_id}</td>
                    <td className="px-5 py-3">{log.total_tokens.toLocaleString()}</td>
                    <td className="px-5 py-3">{log.credits_charged.toLocaleString()}</td>
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
          </div>
        ) : (
          <div className="p-12 text-center">
            <p className="text-4xl mb-3 opacity-30 font-mono">~</p>
            <p className="text-sm font-medium mb-1">No activity yet</p>
            <p className="text-xs text-[var(--text-muted)]">Create an API key and start making requests to see your usage here.</p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-[var(--text-muted)] mt-6">
        Aether Router is a proxy service. We do not control model availability, uptime, or output quality.
        Pricing includes a 55% margin over provider costs to maintain the service.
      </p>
    </div>
  );
}
