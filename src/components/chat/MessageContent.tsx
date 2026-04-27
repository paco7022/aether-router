"use client";

import type { Artifact, Segment } from "@/lib/chat/artifacts";

export function MessageContent({
  segments,
  artifactsById,
  onOpenArtifact,
  activeArtifactId,
}: {
  segments: Segment[];
  artifactsById: Map<string, Artifact>;
  onOpenArtifact: (id: string) => void;
  activeArtifactId: string | null;
}) {
  return (
    <div className="leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            <span key={`t${i}`} style={{ whiteSpace: "pre-wrap" }}>
              {seg.text}
            </span>
          );
        }
        if (seg.kind === "code-inline") {
          return (
            <pre
              key={`c${i}`}
              className="my-2 rounded-lg p-3 text-xs overflow-x-auto font-mono"
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              <code className="text-cyan-200/90">
                {seg.code}
                {!seg.closed && <span className="opacity-50 animate-pulse">▍</span>}
              </code>
            </pre>
          );
        }
        // artifact-ref
        const art = artifactsById.get(seg.artifactId);
        if (!art) {
          return null;
        }
        const lineCount = art.code.split("\n").length;
        const isActive = activeArtifactId === art.id;
        return (
          <button
            key={`a${i}`}
            type="button"
            onClick={() => onOpenArtifact(art.id)}
            className="my-2 w-full text-left rounded-xl px-3 py-2.5 transition-all hover:scale-[1.005]"
            style={{
              background: isActive
                ? "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(34, 211, 238, 0.1))"
                : "rgba(255, 255, 255, 0.04)",
              border: `1px solid ${isActive ? "rgba(139, 92, 246, 0.35)" : "rgba(255, 255, 255, 0.08)"}`,
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: art.kind === "html"
                    ? "rgba(244, 114, 182, 0.15)"
                    : art.kind === "svg"
                      ? "rgba(34, 211, 238, 0.15)"
                      : "rgba(139, 92, 246, 0.15)",
                }}
              >
                {art.kind === "html" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(244, 114, 182)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                ) : art.kind === "svg" ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(34, 211, 238)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(167, 139, 250)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90 truncate">{art.filename}</p>
                <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mt-0.5">
                  {art.language} · {lineCount} {lineCount === 1 ? "line" : "lines"} · click to open
                </p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-dim)] shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </button>
        );
      })}
    </div>
  );
}
