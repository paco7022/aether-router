import { createServerSupabase } from "@/lib/supabase/server";
import { pricePerMTokens, creditsToUsd } from "@/lib/credits";

const CAPABILITY_META: Record<string, { label: string; color: string; icon: string }> = {
  tool_calling:    { label: "Tools",     color: "rgba(59, 130, 246, 0.85)",  icon: "T" },
  vision:          { label: "Vision",    color: "rgba(168, 85, 247, 0.85)",  icon: "V" },
  web_search:      { label: "Search",    color: "rgba(34, 197, 94, 0.85)",   icon: "S" },
  streaming:       { label: "Stream",    color: "rgba(107, 114, 128, 0.60)", icon: "St" },
  json_mode:       { label: "JSON",      color: "rgba(245, 158, 11, 0.85)",  icon: "J" },
  system_message:  { label: "System",    color: "rgba(107, 114, 128, 0.60)", icon: "Sy" },
  reasoning:       { label: "Reasoning", color: "rgba(239, 68, 68, 0.85)",   icon: "R" },
  pdf_input:       { label: "PDF",       color: "rgba(236, 72, 153, 0.85)",  icon: "P" },
};

// Capabilities worth highlighting (skip ubiquitous ones like streaming/system_message)
const HIGHLIGHTED_CAPABILITIES = ["tool_calling", "vision", "web_search", "json_mode", "reasoning", "pdf_input"];

export default async function ModelsPage() {
  const supabase = await createServerSupabase();
  const { data: models } = await supabase
    .from("models")
    .select("*")
    .eq("is_active", true)
    .order("cost_per_m_input", { ascending: true });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Available Models</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          10,000 credits = $1.00 USD. All models include a 25% discount over official API pricing.
        </p>
      </div>

      {/* Free daily allowance notice */}
      <div
        className="mb-5 rounded-xl px-4 py-3 text-xs flex items-start gap-3"
        style={{
          background: "linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(34, 211, 238, 0.04))",
          border: "1px solid rgba(34, 197, 94, 0.15)",
          color: "rgba(167, 243, 208, 0.95)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-emerald-300/80">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <div className="leading-relaxed space-y-1">
          <p>
            <span className="font-semibold text-emerald-200/95">Free daily allowance:</span> the first{" "}
            <span className="font-semibold">200,000 tokens per day</span> on{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">na/</code>{" "}
            models are free for every user (backed by a shared 10M tokens/day global pool). Once
            you cross that daily threshold, further requests are billed at the normal credit rates shown below.
          </p>
          <p>
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">a/deepseek-v3.2</code>{" "}
            is fully free with a hard cap of 200k tokens/day per user and 10M tokens/day globally.
          </p>
          <p className="text-emerald-200/70">All daily counters reset at 00:00 UTC.</p>
        </div>
      </div>

      <div
        className="mb-6 rounded-xl px-4 py-3 text-xs flex items-start gap-3"
        style={{
          background: "linear-gradient(135deg, rgba(139, 92, 246, 0.06), rgba(34, 211, 238, 0.04))",
          border: "1px solid rgba(139, 92, 246, 0.15)",
          color: "rgba(196, 181, 253, 0.95)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-violet-300/80">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <div className="leading-relaxed space-y-1">
          <p>
            <span className="font-semibold text-violet-200/95">Premium-request models</span>{" "}
            (<code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">t/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">an/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">w/</code>)
            are flat-rate: <span className="font-semibold">1 credit per request</span>, plus they consume the
            number of premium requests shown in the &quot;Premium Cost&quot; column from your daily premium pool.
          </p>
        </div>
      </div>

      <div className="glass-card shimmer-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm aurora-table">
            <thead>
              <tr className="text-[var(--text-muted)] text-left">
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Model</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Capabilities</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Input / 1M tokens</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Output / 1M tokens</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Premium Cost</th>
                <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Credits/M (input)</th>
              </tr>
            </thead>
            <tbody>
              {(models || []).map((model) => {
                const isPremium =
                  model.provider === "trolllm" ||
                  model.provider === "antigravity" ||
                  model.provider === "webproxy";
                const creditsInput = pricePerMTokens(model.cost_per_m_input, model.margin);
                const creditsOutput = pricePerMTokens(model.cost_per_m_output, model.margin);
                const priceInput = creditsToUsd(creditsInput);
                const priceOutput = creditsToUsd(creditsOutput);
                const caps: string[] = Array.isArray(model.capabilities)
                  ? model.capabilities
                  : ["streaming", "system_message"];
                const highlightedCaps = caps.filter((c: string) => HIGHLIGHTED_CAPABILITIES.includes(c));
                return (
                  <tr key={model.id} className="group">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div>
                          <p className="font-medium text-white/85">{model.display_name}</p>
                          <p className="text-[11px] text-cyan-300/50 font-mono mt-0.5">{model.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {highlightedCaps.length > 0 ? highlightedCaps.map((cap: string) => {
                          const meta = CAPABILITY_META[cap];
                          if (!meta) return null;
                          return (
                            <span
                              key={cap}
                              title={meta.label}
                              className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                              style={{
                                background: meta.color.replace(/[\d.]+\)$/, "0.12)"),
                                color: meta.color,
                                border: `1px solid ${meta.color.replace(/[\d.]+\)$/, "0.20)")}`,
                              }}
                            >
                              {meta.label}
                            </span>
                          );
                        }) : (
                          <span className="text-[10px] text-[var(--text-dim)]">Text only</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right text-white/70">
                      {isPremium ? <span className="text-[var(--text-dim)]">--</span> : `$${priceInput.toFixed(4)}`}
                    </td>
                    <td className="px-5 py-3.5 text-right text-white/70">
                      {isPremium ? <span className="text-[var(--text-dim)]">--</span> : `$${priceOutput.toFixed(4)}`}
                    </td>
                    <td className="px-5 py-3.5 text-right text-white/70">
                      {Number(model.premium_request_cost) > 0 ? (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          Number(model.premium_request_cost) >= 2
                            ? "badge-error"
                            : Number(model.premium_request_cost) >= 1
                            ? "badge-amber"
                            : "badge-success"
                        }`}>
                          {Number(model.premium_request_cost) === 1 ? "1 req" : `${Number(model.premium_request_cost)} req`}
                        </span>
                      ) : (
                        <span className="text-[var(--text-dim)]">--</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold aurora-text">
                      {isPremium ? "1 credit" : creditsInput.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-[var(--text-dim)] mt-4 leading-relaxed">
        We are a routing service. Model availability and quality depend on upstream providers.
      </p>
    </div>
  );
}
