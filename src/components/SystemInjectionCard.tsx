"use client";

import { useRef, useState } from "react";

const MAX_LENGTH = 8192;

interface Props {
  initialEnabled: boolean;
  initialInjection: string | null;
}

export function SystemInjectionCard({ initialEnabled, initialInjection }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [text, setText] = useState(initialInjection ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setStatus("saving");
    setErrorMsg("");
    const res = await fetch("/api/v1/account/injection", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "AetherRouter",
      },
      body: JSON.stringify({
        system_injection: text.trim() || null,
        system_injection_enabled: enabled,
      }),
    });
    if (res.ok) {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } else {
      const d = await res.json().catch(() => ({}));
      setErrorMsg((d as { error?: string }).error ?? "Failed to save.");
      setStatus("error");
    }
  }

  function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        // SillyTavern character card or preset — extract relevant text
        const parts: string[] = [];
        if (json.system_prompt) parts.push(json.system_prompt);
        if (!parts.length) {
          if (json.description) parts.push(json.description);
          if (json.personality) parts.push(json.personality);
          if (json.scenario) parts.push(json.scenario);
        }
        const extracted = parts.join("\n\n").slice(0, MAX_LENGTH);
        if (extracted) setText(extracted);
      } catch {
        setErrorMsg("Could not parse JSON file.");
        setStatus("error");
      }
      // Reset input so the same file can be imported again
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  const remaining = MAX_LENGTH - text.length;

  return (
    <div className="glass-card shimmer-line p-6 mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aurora-cyan)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h3 className="font-semibold text-white/85">System Prompt Injection</h3>
        </div>

        {/* Toggle */}
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className="relative flex items-center gap-2 cursor-pointer"
          aria-label={enabled ? "Disable injection" : "Enable injection"}
        >
          <span className="text-xs text-[var(--text-dim)]">{enabled ? "Enabled" : "Disabled"}</span>
          <span
            className="relative inline-block w-10 h-5 rounded-full transition-colors duration-200"
            style={{
              background: enabled
                ? "linear-gradient(90deg, rgba(34,211,238,0.5), rgba(139,92,246,0.5))"
                : "rgba(255,255,255,0.07)",
              border: enabled ? "1px solid rgba(34,211,238,0.3)" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-200"
              style={{
                background: enabled ? "rgba(34,211,238,0.9)" : "rgba(255,255,255,0.25)",
                transform: enabled ? "translateX(20px)" : "translateX(0)",
              }}
            />
          </span>
        </button>
      </div>

      <p className="text-xs text-[var(--text-dim)] mb-4 leading-relaxed">
        When enabled, this prompt is injected <strong className="text-white/50">first</strong> in every request you make — before any messages from the client. Useful for setting a persona or instructions that always apply regardless of what app you use.
      </p>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
        placeholder="Enter your system prompt or character description here…"
        rows={8}
        className="w-full rounded-xl text-sm text-white/80 resize-y placeholder:text-white/20 focus:outline-none transition-colors"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          padding: "0.75rem 1rem",
          fontFamily: "inherit",
        }}
      />
      <div className="flex justify-between items-center mt-1 mb-4">
        <span
          className="text-[10px] font-mono"
          style={{ color: remaining < 512 ? "rgba(251,191,36,0.7)" : "rgba(255,255,255,0.2)" }}
        >
          {text.length} / {MAX_LENGTH}
        </span>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-all cursor-pointer disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(34,211,238,0.25))",
            border: "1px solid rgba(139,92,246,0.25)",
          }}
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save"}
        </button>

        {/* SillyTavern JSON import */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 rounded-xl text-sm btn-ghost transition-all cursor-pointer flex items-center gap-1.5"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import SillyTavern JSON
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />

        {text && (
          <button
            type="button"
            onClick={() => setText("")}
            className="px-3 py-2 rounded-xl text-xs text-[var(--text-dim)] hover:text-white/60 transition-all cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {status === "error" && errorMsg && (
        <p className="mt-3 text-xs text-red-400/80">{errorMsg}</p>
      )}
    </div>
  );
}
