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
      <h2 className="text-2xl font-bold mb-2">Available Models</h2>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        Prices include a 55% margin over provider costs. 10,000 credits = $1.00 USD.
      </p>

      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-muted)] text-left border-b border-[var(--border)]">
              <th className="px-5 py-3 font-medium">Model</th>
              <th className="px-5 py-3 font-medium">Provider</th>
              <th className="px-5 py-3 font-medium text-right">Provider Cost/M</th>
              <th className="px-5 py-3 font-medium text-right">Your Price/M</th>
              <th className="px-5 py-3 font-medium text-right">Credits/M tokens</th>
            </tr>
          </thead>
          <tbody>
            {(models || []).map((model) => {
              const creditsPerM = pricePerMTokens(model.cost_per_m_input, model.margin);
              const yourPrice = creditsToUsd(creditsPerM);
              return (
                <tr key={model.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]">
                  <td className="px-5 py-3">
                    <p className="font-medium">{model.display_name}</p>
                    <p className="text-xs text-[var(--text-muted)] font-mono">{model.id}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-[var(--accent)]/10 text-[var(--accent)]">
                      {model.provider}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-[var(--text-muted)]">
                    ${Number(model.cost_per_m_input).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    ${yourPrice.toFixed(4)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {creditsPerM.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-4">
        We are a routing service. Model availability and quality depend on upstream providers.
      </p>
    </div>
  );
}
