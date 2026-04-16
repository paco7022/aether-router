import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AnalyticsCharts } from "./charts";

export default async function AnalyticsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  // Fetch last 14 days of usage logs for this user
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 13);
  fourteenDaysAgo.setUTCHours(0, 0, 0, 0);

  const { data: logs } = await admin
    .from("usage_logs")
    .select("created_at, total_tokens, prompt_tokens, completion_tokens, credits_charged, model_id, status")
    .eq("user_id", user!.id)
    .gte("created_at", fourteenDaysAgo.toISOString())
    .order("created_at", { ascending: true });

  // Aggregate by day
  const dayMap = new Map<
    string,
    { date: string; requests: number; tokens: number; promptTokens: number; completionTokens: number; credits: number }
  >();

  // Pre-fill all 14 days so the chart is continuous
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenDaysAgo);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().split("T")[0];
    dayMap.set(key, { date: key, requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, credits: 0 });
  }

  for (const log of logs || []) {
    const key = new Date(log.created_at).toISOString().split("T")[0];
    const entry = dayMap.get(key);
    if (entry) {
      entry.requests += 1;
      entry.tokens += log.total_tokens || 0;
      entry.promptTokens += log.prompt_tokens || 0;
      entry.completionTokens += log.completion_tokens || 0;
      entry.credits += log.credits_charged || 0;
    }
  }

  const dailyData = Array.from(dayMap.values());

  // Model breakdown for the donut chart
  const modelMap = new Map<string, { model: string; requests: number; tokens: number }>();
  for (const log of logs || []) {
    const m = log.model_id;
    const entry = modelMap.get(m) || { model: m, requests: 0, tokens: 0 };
    entry.requests += 1;
    entry.tokens += log.total_tokens || 0;
    modelMap.set(m, entry);
  }
  const modelBreakdown = Array.from(modelMap.values())
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 8);

  // Summary stats
  const totalRequests = dailyData.reduce((s, d) => s + d.requests, 0);
  const totalTokens = dailyData.reduce((s, d) => s + d.tokens, 0);
  const totalCredits = dailyData.reduce((s, d) => s + d.credits, 0);
  const avgRequestsPerDay = totalRequests / 14;
  const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0;
  const peakDay = dailyData.reduce((max, d) => (d.requests > max.requests ? d : max), dailyData[0]);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Analytics</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Usage trends over the last 14 days
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass-card aurora-border shimmer-line p-4 glow-blue group">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">
            14-Day Requests
          </p>
          <p className="text-2xl font-bold text-white/90 tracking-tight">{totalRequests.toLocaleString()}</p>
          <p className="text-[11px] text-blue-400/50 mt-1">
            ~{avgRequestsPerDay.toFixed(1)}/day avg
          </p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-4 glow-cyan group">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">
            14-Day Tokens
          </p>
          <p className="text-2xl font-bold text-white/90 tracking-tight">
            {totalTokens >= 1_000_000
              ? `${(totalTokens / 1_000_000).toFixed(1)}M`
              : totalTokens >= 1_000
              ? `${(totalTokens / 1_000).toFixed(1)}K`
              : totalTokens.toLocaleString()}
          </p>
          <p className="text-[11px] text-cyan-400/50 mt-1">
            ~{avgTokensPerRequest.toFixed(0)}/req avg
          </p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-4 glow-green group">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">
            14-Day Credits
          </p>
          <p className="text-2xl font-bold text-white/90 tracking-tight">{totalCredits.toLocaleString()}</p>
          <p className="text-[11px] text-emerald-400/50 mt-1">
            ${(totalCredits / 10_000).toFixed(2)} USD
          </p>
        </div>
        <div className="glass-card aurora-border shimmer-line p-4 glow-violet group">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-2">
            Peak Day
          </p>
          <p className="text-2xl font-bold text-white/90 tracking-tight">
            {peakDay?.requests.toLocaleString() ?? 0}
          </p>
          <p className="text-[11px] text-violet-400/50 mt-1">
            {peakDay ? new Date(peakDay.date + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric" }) : "--"}
          </p>
        </div>
      </div>

      <AnalyticsCharts dailyData={dailyData} modelBreakdown={modelBreakdown} />
    </div>
  );
}
