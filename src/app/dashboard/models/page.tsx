import { createServerSupabase } from "@/lib/supabase/server";
import { pricePerMTokens, creditsToUsd } from "@/lib/credits";

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
        <h2 className="text-2xl font-bold text-white/90">Available Models</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          10,000 credits = $1.00 USD. All models include a 25% discount over official API pricing.
        </p>
      </div>

      <div className="glass-card shimmer-line overflow-hidden">
        <table className="w-full text-sm aurora-table">
          <thead>
            <tr className="text-[var(--text-muted)] text-left">
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider">Model</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Input / 1M tokens</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Output / 1M tokens</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Premium Cost</th>
              <th className="px-5 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Credits/M (input)</th>
            </tr>
          </thead>
          <tbody>
            {(models || []).map((model) => {
              const creditsInput = pricePerMTokens(model.cost_per_m_input, model.margin);
              const creditsOutput = pricePerMTokens(model.cost_per_m_output, model.margin);
              const priceInput = creditsToUsd(creditsInput);
              const priceOutput = creditsToUsd(creditsOutput);
              return (
                <tr key={model.id}>
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-white/85">{model.display_name}</p>
                    <p className="text-[11px] text-cyan-300/50 font-mono mt-0.5">{model.id}</p>
                  </td>
                  <td className="px-5 py-3.5 text-right text-white/70">
                    ${priceInput.toFixed(4)}
                  </td>
                  <td className="px-5 py-3.5 text-right text-white/70">
                    ${priceOutput.toFixed(4)}
                  </td>
                  <td className="px-5 py-3.5 text-right text-white/70">
                    {Number(model.premium_request_cost) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{
                        background: Number(model.premium_request_cost) >= 2 ? "rgba(239, 68, 68, 0.1)" : Number(model.premium_request_cost) >= 1 ? "rgba(245, 158, 11, 0.1)" : "rgba(34, 197, 94, 0.1)",
                        border: `1px solid ${Number(model.premium_request_cost) >= 2 ? "rgba(239, 68, 68, 0.2)" : Number(model.premium_request_cost) >= 1 ? "rgba(245, 158, 11, 0.2)" : "rgba(34, 197, 94, 0.2)"}`,
                        color: Number(model.premium_request_cost) >= 2 ? "rgba(252, 165, 165, 0.9)" : Number(model.premium_request_cost) >= 1 ? "rgba(251, 191, 36, 0.9)" : "rgba(134, 239, 172, 0.9)",
                      }}>
                        {Number(model.premium_request_cost) === 1 ? "1 req" : `${Number(model.premium_request_cost)} req`}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold aurora-text">
                    {creditsInput.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-dim)] mt-4">
        We are a routing service. Model availability and quality depend on upstream providers.
      </p>
    </div>
  );
}
