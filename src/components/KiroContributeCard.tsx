"use client";

import { useEffect, useState } from "react";

interface PoolStatus {
  used: number;
  max: number;
  slots_free: number;
  mine: number;
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
      setError("Pega el contenido de tu kiro-auth-token.json o tu refreshToken.");
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
        setError(data?.error || "Algo salió mal. Intenta de nuevo.");
        setStatus("idle");
        return;
      }
      setOk(data?.message || "¡Cuenta añadida al pool!");
      setValue("");
      loadStatus();
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setStatus("idle");
    }
  }

  const full = pool ? pool.slots_free <= 0 : false;

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
            <h3 className="font-semibold text-white/85">Aporta tu cuenta Kiro</h3>
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
                {pool.used}/{pool.max} en uso
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
            Pool comunitario: aporta tu cuenta de Kiro y <span className="text-white/80">todos</span> (free
            incluido) usan Claude real a solo <span className="text-white/80">0.5 request</span>. Cuantas
            más cuentas, mejor aguanta el pool.
          </p>
        </div>
      </div>

      {/* Warnings — the two things a contributor MUST understand */}
      <div className="space-y-2 mb-4">
        <div className="rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.20)", color: "rgba(253,224,71,0.95)" }}>
          ⚠️ <span className="font-medium">Haz LOGOUT de Kiro Desktop</span> después de aportar (o usa otra
          cuenta ahí). Si la sigues usando en Desktop, tu cuenta se desincroniza y <span className="font-medium">muere en ~1 hora</span>.
        </div>
        <div className="rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.20)", color: "rgba(252,165,165,0.95)" }}>
          ⚠️ Tu cuenta enruta tráfico de otros usuarios y <span className="font-medium">puede ser baneada</span> por
          Amazon por el contenido de la plataforma. Aporta solo si lo aceptas.
        </div>
      </div>

      {/* Paste box */}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Pega aquí el contenido de kiro-auth-token.json (incluye "refreshToken": "...")'
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
            <p className="text-[11px] text-[var(--text-dim)]">Ups, demasiadas cuentas ahora mismo. Intenta más tarde.</p>
          ) : (
            <p className="text-[11px] text-[var(--text-dim)]">Tu token nunca se guarda en nuestra base — se manda cifrado al pool.</p>
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
          {status === "saving" ? "Validando…" : "Aportar cuenta"}
        </button>
      </div>

      {/* How to get the token */}
      <div className="mt-4 rounded-xl px-3.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="font-medium text-white/70">Cómo sacar tu token:</span> loguéate en Kiro (Google) →
        abre el archivo <span className="text-white/80 font-mono">kiro-auth-token.json</span> (en Windows:
        <span className="text-white/80 font-mono"> %USERPROFILE%\.aws\sso\cache\</span>) → copia y pega todo su contenido aquí.
      </div>
    </div>
  );
}
