"use client";

import { useState } from "react";

export function ReferralLinkCard({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const link = typeof window !== "undefined"
    ? `${window.location.origin}/register?ref=${code}`
    : `/register?ref=${code}`;

  async function copy(value: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // no-op
    }
  }

  return (
    <div className="glass-card shimmer-line p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-white/85">Your invite link</h3>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">
            Code
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm text-white/90 bg-[var(--bg-input)] border border-white/[0.06] rounded-xl px-4 py-2.5 select-all">
              {code || "—"}
            </code>
            <button
              type="button"
              onClick={() => copy(code, "code")}
              disabled={!code}
              className="btn-ghost rounded-xl px-4 py-2.5 text-xs font-medium disabled:opacity-50"
            >
              {copied === "code" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">
            Share link
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs text-white/80 bg-[var(--bg-input)] border border-white/[0.06] rounded-xl px-4 py-2.5 truncate select-all">
              {link}
            </code>
            <button
              type="button"
              onClick={() => copy(link, "link")}
              disabled={!code}
              className="btn-aurora rounded-xl px-4 py-2.5 text-xs font-medium disabled:opacity-50"
            >
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
