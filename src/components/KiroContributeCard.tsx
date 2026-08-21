"use client";

import { useEffect, useState } from "react";

interface PoolStatus {
  used: number;
  max: number;
  slots_free: number;
  mine: number;
}

// One-liners users run on their own PC to copy their Kiro refresh token to the
// clipboard, so they only have to paste it below.
const EXTRACT_COMMANDS: { os: string; cmd: string }[] = [
  {
    os: "Windows (PowerShell)",
    cmd: `(Get-Content "$env:USERPROFILE\\.aws\\sso\\cache\\kiro-auth-token.json" -Raw | ConvertFrom-Json).refreshToken | Set-Clipboard`,
  },
  {
    os: "macOS",
    cmd: `python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.aws/sso/cache/kiro-auth-token.json')))['refreshToken'])" | pbcopy`,
  },
  {
    os: "Linux",
    cmd: `python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.aws/sso/cache/kiro-auth-token.json')))['refreshToken'])" | xclip -selection clipboard`,
  },
];

function CommandRow({ os, cmd }: { os: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-medium text-white/60 uppercase tracking-wide">{os}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(cmd).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="text-[10px] px-2 py-0.5 rounded-md text-white/70 hover:text-white transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-[10px] font-mono text-white/70 overflow-x-auto rounded-lg px-2.5 py-2 whitespace-pre" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {cmd}
      </pre>
    </div>
  );
}

export function KiroContributeCard() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pool, setPool] = useState<PoolStatus | null>(null);

  async function loadStatus() {
    try {
      const res = await fetch("/api/v1/kiro/contribute", {
        headers: { "X-Requested-With": "AetherRouter" },
      });
      if (res.ok) setPool(await res.json());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleSubmit() {
    setError("");
    setOk("");
    const trimmed = value.trim();
    if (trimmed.length < 20) {
      setError("Paste the contents of your kiro-auth-token.json, or your refreshToken.");
      return;
    }
    setStatus("saving");
    try {
      const res = await fetch("/api/v1/kiro/contribute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "AetherRouter",
        },
        body: JSON.stringify({ token_json: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }
      setOk(data?.message || "Account added to the pool!");
      setValue("");
      loadStatus();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  // Contributors with an account already in the pool are re-syncing it, not
  // taking a new slot — a full pool must not lock them out of the box.
  const mine = pool?.mine ?? 0;
  const full = pool ? pool.slots_free <= 0 && mine === 0 : false;

  return (
    <div className="glass-card shimmer-line p-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[#a78bfa]"
          style={{
            background:
              "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(88, 101, 242, 0.12))",
            border: "1px solid rgba(139, 92, 246, 0.20)",
          }}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 2 7l10 5 10-5-10-5Z" />
            <path d="m2 17 10 5 10-5" />
            <path d="m2 12 10 5 10-5" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white/85">Contribute your Kiro account</h3>
            {pool && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: full ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.12)",
                  color: full ? "rgba(248,113,113,0.95)" : "rgba(52,211,153,0.95)",
                  border: `1px solid ${full ? "rgba(248,113,113,0.20)" : "rgba(52,211,153,0.20)"}`,
                }}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${full ? "bg-red-400" : "bg-emerald-400"}`} />
                {pool.used}/{pool.max} in use
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
            Community pool: contribute your Kiro account and every{" "}
            <span className="text-white/80">paid plan</span> gets real Claude through{" "}
            <span className="text-white/80">k/</span> at the standard premium price (Opus 6, Sonnet 3
            requests). The more accounts, the better the pool holds up.
          </p>
        </div>
      </div>

      {/* Warnings — the two things a contributor MUST understand */}
      <div className="space-y-2 mb-4">
        <div className="rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.20)", color: "rgba(253,224,71,0.95)" }}>
          ⚠️ <span className="font-medium">LOG OUT of Kiro Desktop</span> after contributing (or use a
          different account there). If you keep using it in Desktop, your account desyncs and{" "}
          <span className="font-medium">dies within ~1 hour</span>.
        </div>
        <div className="rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.20)", color: "rgba(252,165,165,0.95)" }}>
          ⚠️ Your account routes other users&apos; traffic and <span className="font-medium">may be banned</span> by
          Amazon over the platform&apos;s content. Only contribute if you accept that.
        </div>
        {mine > 0 && (
          <div className="rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed" style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.20)", color: "rgba(147,197,253,0.95)" }}>
            You already have an account in the pool. Pasting a token again{" "}
            <span className="font-medium">re-syncs that same account</span> (it never creates a second
            one), which is how you revive it if Kiro Desktop rotated your token.
          </div>
        )}
      </div>

      {/* Paste box */}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Paste the contents of kiro-auth-token.json here (includes "refreshToken": "...")'
        rows={4}
        disabled={full}
        className="w-full rounded-xl bg-white/[0.03] border border-white/[0.08] px-3.5 py-2.5 text-xs font-mono text-white/85 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[#a78bfa]/50 focus:bg-white/[0.05] transition-colors resize-y disabled:opacity-50"
      />

      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <div className="min-h-[18px] flex-1">
          {error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : ok ? (
            <p className="text-xs text-emerald-400">{ok}</p>
          ) : full ? (
            <p className="text-[11px] text-[var(--text-dim)]">Oops, too many accounts right now. Try again later.</p>
          ) : (
            <p className="text-[11px] text-[var(--text-dim)]">Your token is never stored in our database — it&apos;s sent straight to the pool.</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "saving" || full}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all cursor-pointer disabled:opacity-60"
          style={{
            background: "linear-gradient(135deg, #8b5cf6, #a78bfa)",
            border: "1px solid rgba(167, 139, 250, 0.4)",
          }}
        >
          {status === "saving" ? "Validating…" : "Contribute account"}
        </button>
      </div>

      {/* How to get the token */}
      <div className="mt-4 rounded-xl px-3.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="font-medium text-white/70">How to get your token:</span> first{" "}
        <span className="text-white/80">log in to Kiro</span> (Google). Then run the command for your OS — it
        copies your refresh token to the clipboard, and you just paste it above:
        {EXTRACT_COMMANDS.map((c) => (
          <CommandRow key={c.os} os={c.os} cmd={c.cmd} />
        ))}
        <p className="mt-2 text-[10px] text-[var(--text-dim)]">
          Prefer to do it by hand? Open{" "}
          <span className="text-white/70 font-mono">~/.aws/sso/cache/kiro-auth-token.json</span> and paste its full contents.
        </p>
      </div>
    </div>
  );
}
