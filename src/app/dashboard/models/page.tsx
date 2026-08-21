import { createServerSupabase } from "@/lib/supabase/server";
import { pricePerMTokens, creditsToUsd } from "@/lib/credits";
import { isPremiumProvider as isPremiumProviderName, isFlatRateProvider as isFlatRateProviderName } from "@/lib/providers/types";
import { classifyFamily } from "@/lib/model-family";
import ModelsTable, { type ModelRow } from "./models-table";

// Capabilities worth highlighting (skip ubiquitous ones like streaming/system_message)
const HIGHLIGHTED_CAPABILITIES = ["tool_calling", "vision", "web_search", "json_mode", "reasoning", "pdf_input"];

// Models added within this window get a "New" highlight on the table
const NEW_MODEL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default async function ModelsPage() {
  const supabase = await createServerSupabase();
  const { data: models } = await supabase
    .from("models")
    .select("*")
    .eq("is_active", true)
    .order("cost_per_m_input", { ascending: true });

  const newThreshold = Date.now() - NEW_MODEL_WINDOW_MS;

  // Los modelos de imagen/video viven en la misma tabla pero no se cobran por
  // token: en esta tabla saldrían con precio $0.0000, que se lee como "gratis".
  // Tienen su propia página con su propio precio por generación.
  const chatModels = (models || []).filter((m) => (m.modality ?? "text") === "text");
  const hasMediaModels = (models || []).length > chatModels.length;

  const rows: ModelRow[] = chatModels.map((model) => {
    const isPremium = isPremiumProviderName(model.provider);
    const isFlatRate = isFlatRateProviderName(model.provider);
    // Premium models bill a flat 1 credit + a premium request in "request"
    // mode, so their per-token columns are the PAYG rate — what the account is
    // charged once it switches billing_mode to 'payg'. Those rates are stored
    // as credits directly (margin already baked in), unlike cost_per_m which is
    // our raw upstream cost and still needs margin applied.
    const paygIn = Number(model.payg_credits_per_m_input) || 0;
    const paygOut = Number(model.payg_credits_per_m_output) || 0;
    const creditsInput =
      isPremium && paygIn > 0 ? paygIn : pricePerMTokens(model.cost_per_m_input, model.margin);
    const creditsOutput =
      isPremium && paygOut > 0 ? paygOut : pricePerMTokens(model.cost_per_m_output, model.margin);
    const caps: string[] = Array.isArray(model.capabilities)
      ? model.capabilities
      : ["streaming", "system_message"];
    const createdAt = model.created_at ? new Date(model.created_at).getTime() : 0;
    const family = classifyFamily(model.display_name ?? "", model.id ?? "");
    return {
      id: model.id,
      displayName: model.display_name,
      familyKey: family.key,
      familyLabel: family.label,
      familyColor: family.color,
      highlightedCaps: caps.filter((c: string) => HIGHLIGHTED_CAPABILITIES.includes(c)),
      priceInput: creditsToUsd(creditsInput).toFixed(4),
      priceOutput: creditsToUsd(creditsOutput).toFixed(4),
      premiumRequestCost: Number(model.premium_request_cost),
      isPremium,
      isFlatRate,
      creditsInputLabel: creditsInput.toLocaleString(),
      isNew: createdAt >= newThreshold,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white/90 tracking-tight">Available Models</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          10,000 credits = $1.00 USD. All models include a 25% discount over official API pricing.
          Per-token prices on premium models apply when your account is on{" "}
          <a href="/dashboard/settings" className="text-[var(--aurora-violet)] hover:underline">
            Pay as you go
          </a>
          ; on the default per-request mode they cost 1 credit plus the premium requests shown.
        </p>
      </div>

      {/* Paid-plan allowance notice (free tier removed 2026-08-21) */}
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
            <span className="font-semibold text-emerald-200/95">Paid plans only:</span>{" "}
            the free tier has been discontinued &mdash; routing requires an active plan. Each plan
            includes its own <span className="font-semibold">daily premium-request allowance</span>{" "}
            plus daily credits; see{" "}
            <a href="/dashboard/billing" className="underline">Billing</a>.
          </p>
          <p>
            Premium-model calls consume the amount shown in the &quot;Premium Cost&quot; column.
            Paid credits are only used for regular credit-priced models or overage.
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
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">w/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">h/</code>,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">gm/</code>
            ,{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">r/</code>)
            are flat-rate: <span className="font-semibold">1 credit per request</span>, plus they consume the
            number of premium requests shown in the &quot;Premium Cost&quot; column from your daily premium pool.
          </p>
          <p>
            <span className="font-semibold text-emerald-200/95">Flat-rate models</span>{" "}
            (<code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">op/</code>)
            charge a small fixed fee per request with <span className="font-semibold">no context limit</span> —{" "}
            shown in the &quot;Premium Cost&quot; column. No premium-request pool consumption.
          </p>
        </div>
      </div>

      <ModelsTable models={rows} />

      {hasMediaModels && (
        <p className="text-xs text-[var(--text-muted)] mt-4 leading-relaxed">
          Image and video models (<code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">img/</code>,{" "}
          <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-white/[0.04]">vid/</code>) are billed per
          generation instead of per token — see{" "}
          <a href="/dashboard/images" className="text-[var(--aurora-violet)] hover:underline">
            Image Studio
          </a>
          .
        </p>
      )}

      <p className="text-xs text-[var(--text-dim)] mt-4 leading-relaxed">
        We are a routing service. Model availability and quality depend on upstream providers.
      </p>
    </div>
  );
}
