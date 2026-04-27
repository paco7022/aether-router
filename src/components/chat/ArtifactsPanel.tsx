"use client";

import { useEffect, useState } from "react";
import type { Artifact } from "@/lib/chat/artifacts";
import { CodeView } from "./CodeView";
import { ArtifactPreview } from "./ArtifactPreview";

type ViewMode = "code" | "preview";

export function ArtifactsPanel({
  artifacts,
  activeId,
  onSelect,
  onClose,
}: {
  artifacts: Artifact[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1];
  const [view, setView] = useState<ViewMode>("code");
  const [copied, setCopied] = useState(false);

  // Default to preview for html/svg, code for everything else, every time
  // the selected artifact changes. The user can still flip with the toggle.
  useEffect(() => {
    if (!active) return;
    setView(active.kind === "html" || active.kind === "svg" ? "preview" : "code");
  }, [active?.id, active?.kind]);

  if (!active) return null;

  const canPreview = active.kind === "html" || active.kind === "svg";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  function handleDownload() {
    const blob = new Blob([active.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = active.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="w-[45%] min-w-[420px] max-w-[640px] glass-card shimmer-line flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/[0.04] flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white/90 truncate">{active.filename}</p>
          <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mt-0.5">
            {active.language} · {active.code.split("\n").length} lines
          </p>
        </div>

        {canPreview && (
          <div
            className="flex rounded-lg p-0.5"
            style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          >
            <button
              type="button"
              onClick={() => setView("preview")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                view === "preview" ? "text-white" : "text-[var(--text-muted)] hover:text-white/80"
              }`}
              style={view === "preview" ? {
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(34, 211, 238, 0.15))",
              } : undefined}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setView("code")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                view === "code" ? "text-white" : "text-[var(--text-muted)] hover:text-white/80"
              }`}
              style={view === "code" ? {
                background: "linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(34, 211, 238, 0.15))",
              } : undefined}
            >
              Code
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-white/90 transition-colors"
          style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          title="Copy to clipboard"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-white/90 transition-colors"
          style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          title="Download file"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-white/90 transition-colors"
          style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          aria-label="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Tabs (only show when 2+ artifacts) */}
      {artifacts.length > 1 && (
        <div
          className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-white/[0.04]"
          style={{ scrollbarWidth: "thin" }}
        >
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              className={`shrink-0 px-2.5 py-1 text-[11px] font-mono rounded-md transition-colors ${
                a.id === active.id ? "text-white" : "text-[var(--text-muted)] hover:text-white/80"
              }`}
              style={a.id === active.id ? {
                background: "rgba(139, 92, 246, 0.18)",
                border: "1px solid rgba(139, 92, 246, 0.3)",
              } : {
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.04)",
              }}
              title={a.filename}
            >
              {a.filename}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {view === "preview" && canPreview ? (
          <ArtifactPreview artifact={active} />
        ) : (
          <div className="h-full overflow-auto">
            <CodeView language={active.language} code={active.code} />
          </div>
        )}
      </div>
    </aside>
  );
}
