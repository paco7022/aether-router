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
