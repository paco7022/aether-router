"use client";

import { useMemo, useState } from "react";

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

export type ModelRow = {
  id: string;
  displayName: string;
  highlightedCaps: string[];
  priceInput: string;
  priceOutput: string;
  premiumRequestCost: number;
  isPremium: boolean;
  isFlatRate: boolean;
  creditsInputLabel: string;
  isNew: boolean;
};

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // Fallback for browsers/contexts without the async clipboard API
      const ta = document.createElement("textarea");
      ta.value = id;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy model ID"
      className="group/copy inline-flex items-center gap-1 mt-0.5 text-[11px] text-cyan-300/50 font-mono hover:text-cyan-200/90 transition-colors cursor-pointer"
    >
      <span>{id}</span>
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 group-hover/copy:opacity-100 transition-opacity">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default function ModelsTable({ models }: { models: ModelRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [models, query]);

  return (
    <>
      <div className="mb-4 relative max-w-md">
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] pointer-events-none"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models (e.g. Claude, gpt, gemini)…"
          className="w-full rounded-xl bg-white/[0.03] border border-white/[0.08] pl-9 pr-9 py-2.5 text-sm text-white/85 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-cyan-400/40 focus:bg-white/[0.05] transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            title="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-white/70 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--text-muted)] text-sm">
                    No models match &quot;{query}&quot;.
                  </td>
                </tr>
              ) : filtered.map((model) => (
                <tr
                  key={model.id}
                  className="group"
                  style={model.isNew ? { background: "linear-gradient(90deg, rgba(34, 211, 238, 0.06), transparent 60%)" } : undefined}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div>
                        <p className="font-medium text-white/85 flex items-center gap-2">
                          {model.displayName}
                          {model.isNew && (
                            <span
                              className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                              style={{
                                background: "rgba(34, 211, 238, 0.14)",
                                color: "rgba(103, 232, 249, 0.95)",
                                border: "1px solid rgba(34, 211, 238, 0.30)",
                              }}
                            >
                              New
                            </span>
                          )}
                        </p>
                        <CopyableId id={model.id} />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {model.highlightedCaps.length > 0 ? model.highlightedCaps.map((cap) => {
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
                    {model.isPremium || model.isFlatRate ? <span className="text-[var(--text-dim)]">--</span> : `$${model.priceInput}`}
                  </td>
                  <td className="px-5 py-3.5 text-right text-white/70">
                    {model.isPremium || model.isFlatRate ? <span className="text-[var(--text-dim)]">--</span> : `$${model.priceOutput}`}
                  </td>
                  <td className="px-5 py-3.5 text-right text-white/70">
                    {model.isFlatRate ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full badge-success">
                        {model.premiumRequestCost.toFixed(1)} cr
                      </span>
                    ) : model.premiumRequestCost > 0 ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        model.premiumRequestCost >= 2
                          ? "badge-error"
                          : model.premiumRequestCost >= 1
                          ? "badge-amber"
                          : "badge-success"
                      }`}>
                        {model.premiumRequestCost === 1 ? "1 req" : `${model.premiumRequestCost} req`}
                      </span>
                    ) : (
                      <span className="text-[var(--text-dim)]">--</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold aurora-text">
                    {model.isPremium ? "1 credit" : model.isFlatRate ? `${model.premiumRequestCost.toFixed(1)} cr` : model.creditsInputLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
