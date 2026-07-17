"use client";

import { useMemo, useState } from "react";
import { FAMILY_ORDER } from "@/lib/model-family";

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
  familyKey: string;
  familyLabel: string;
  familyColor: string;
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

function ModelDataRow({ model }: { model: ModelRow }) {
  return (
    <tr
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
        {model.isFlatRate ? <span className="text-[var(--text-dim)]">--</span> : `$${model.priceInput}`}
      </td>
      <td className="px-5 py-3.5 text-right text-white/70">
        {model.isFlatRate ? <span className="text-[var(--text-dim)]">--</span> : `$${model.priceOutput}`}
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
  );
}

export default function ModelsTable({ models }: { models: ModelRow[] }) {
  const [query, setQuery] = useState("");
  const [activeFamily, setActiveFamily] = useState<string>("all");

  // Families present in the catalog, ordered, with counts.
  const families = useMemo(() => {
    const map = new Map<string, { key: string; label: string; color: string; count: number }>();
    for (const m of models) {
      const existing = map.get(m.familyKey);
      if (existing) existing.count++;
      else map.set(m.familyKey, { key: m.familyKey, label: m.familyLabel, color: m.familyColor, count: 1 });
    }
    return Array.from(map.values()).sort(
      (a, b) => FAMILY_ORDER.indexOf(a.key) - FAMILY_ORDER.indexOf(b.key)
    );
  }, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (activeFamily !== "all" && m.familyKey !== activeFamily) return false;
      if (q && !m.displayName.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [models, query, activeFamily]);

  // Group the filtered rows by family, in display order.
  const groups = useMemo(() => {
    const byKey = new Map<string, ModelRow[]>();
    for (const m of filtered) {
      const arr = byKey.get(m.familyKey);
      if (arr) arr.push(m);
      else byKey.set(m.familyKey, [m]);
    }
    return families
      .filter((f) => byKey.has(f.key))
      .map((f) => ({ ...f, rows: byKey.get(f.key)! }));
  }, [filtered, families]);

  return (
    <>
      {/* Search */}
      <div className="mb-3 relative max-w-md">
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

      {/* Provider / family filter chips */}
      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveFamily("all")}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
            activeFamily === "all"
              ? "bg-white/[0.08] border-white/20 text-white/90"
              : "bg-white/[0.02] border-white/[0.08] text-[var(--text-muted)] hover:text-white/80 hover:border-white/15"
          }`}
        >
          All
          <span className="text-[10px] text-[var(--text-dim)]">{models.length}</span>
        </button>
        {families.map((f) => {
          const active = activeFamily === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFamily(active ? "all" : f.key)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? "bg-white/[0.08] border-white/20 text-white/90"
                  : "bg-white/[0.02] border-white/[0.08] text-[var(--text-muted)] hover:text-white/80 hover:border-white/15"
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: f.color }} />
              {f.label}
              <span className="text-[10px] text-[var(--text-dim)]">{f.count}</span>
            </button>
          );
        })}
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
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--text-muted)] text-sm">
                    No models match your filters.
                  </td>
                </tr>
              ) : groups.map((g) => (
                <FamilyGroup key={g.key} label={g.label} color={g.color} count={g.rows.length} rows={g.rows} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FamilyGroup({ label, color, count, rows }: { label: string; color: string; count: number; rows: ModelRow[] }) {
  return (
    <>
      <tr>
        <td colSpan={6} className="px-5 py-2.5 bg-white/[0.02] border-y border-white/[0.05]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{label}</span>
            <span className="text-[10px] text-[var(--text-dim)]">
              {count} {count === 1 ? "model" : "models"}
            </span>
          </div>
        </td>
      </tr>
      {rows.map((m) => (
        <ModelDataRow key={m.id} model={m} />
      ))}
    </>
  );
}
