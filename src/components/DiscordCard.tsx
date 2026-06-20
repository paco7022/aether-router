"use client";

import { useState } from "react";

const DISCORD_INVITE_URL = "https://discord.gg/GyV43jg68f";
const DISCORD_ID_RE = /^\d{17,20}$/;

const DiscordLogo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.332-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z" />
  </svg>
);

export function DiscordCard({ initialDiscordId }: { initialDiscordId: string | null }) {
  const [value, setValue] = useState(initialDiscordId ?? "");
  const [linkedId, setLinkedId] = useState(initialDiscordId ?? "");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const isLinked = linkedId.length > 0;

  async function handleSave() {
    setError("");
    setSaved(false);
    const trimmed = value.trim();
    if (trimmed.length > 0 && !DISCORD_ID_RE.test(trimmed)) {
      setError("Enter a valid Discord ID (17-20 digits).");
      return;
    }
    setStatus("saving");
    try {
      const res = await fetch("/api/v1/account/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "AetherRouter" },
        body: JSON.stringify({ discord_id: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }
      setLinkedId(data.discord_id ?? "");
      setValue(data.discord_id ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="glass-card shimmer-line p-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[#7b86f5]"
          style={{
            background: "linear-gradient(135deg, rgba(88, 101, 242, 0.18), rgba(139, 92, 246, 0.12))",
            border: "1px solid rgba(88, 101, 242, 0.20)",
          }}
        >
          <DiscordLogo />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white/85">Discord ID</h3>
            {isLinked ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full badge-success">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Linked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(148,163,184,0.12)", color: "rgba(148,163,184,0.95)", border: "1px solid rgba(148,163,184,0.20)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Not linked
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
            Link your Discord for priority support &amp; exclusive giveaways. Optional — you can add or remove it anytime.
          </p>
        </div>
      </div>

      {/* Input + Save */}
      <div className="flex gap-2 items-stretch">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="Enter your Discord ID"
          className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.08] px-3.5 py-2.5 text-sm text-white/85 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[#7b86f5]/50 focus:bg-white/[0.05] transition-colors"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={status === "saving"}
          className="px-5 rounded-xl text-sm font-semibold text-white transition-all cursor-pointer disabled:opacity-60"
          style={{
            background: "linear-gradient(135deg, #5865f2, #7b86f5)",
            border: "1px solid rgba(123, 134, 245, 0.4)",
          }}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Helper / feedback */}
      <div className="mt-2 min-h-[18px]">
        {error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : saved ? (
          <p className="text-xs text-emerald-400">{isLinked ? "Discord ID saved." : "Discord ID removed."}</p>
        ) : (
          <p className="text-[11px] text-[var(--text-dim)]">To remove your Discord ID, leave empty and save.</p>
        )}
      </div>

      {/* How to find your ID */}
      <div className="mt-4 rounded-xl px-3.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="font-medium text-white/70">How to find your Discord ID:</span> open Discord → User Settings → Advanced → enable <span className="text-white/80">Developer Mode</span>, then right-click your username and choose <span className="text-white/80">Copy User ID</span>.
      </div>

      {/* Go to Discord */}
      <div className="mt-5 pt-5 border-t border-white/[0.05] flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-[var(--text-muted)]">Not in our server yet? Come hang out and grab your role.</p>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white/90 transition-all"
          style={{ background: "rgba(88, 101, 242, 0.14)", border: "1px solid rgba(88, 101, 242, 0.30)" }}
        >
          <DiscordLogo size={16} />
          Go to Discord
        </a>
      </div>
    </div>
  );
}
