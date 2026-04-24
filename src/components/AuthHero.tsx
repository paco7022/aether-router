const providers = [
  { label: "OpenAI", tone: "from-emerald-400/80 to-teal-400/80" },
  { label: "Anthropic", tone: "from-orange-400/80 to-amber-400/80" },
  { label: "Google", tone: "from-blue-400/80 to-cyan-400/80" },
  { label: "xAI", tone: "from-zinc-300/80 to-zinc-500/80" },
  { label: "Mistral", tone: "from-orange-500/80 to-red-500/80" },
  { label: "Groq", tone: "from-red-400/80 to-rose-400/80" },
];

const features = [
  {
    title: "One API, every model",
    desc: "GPT, Claude, Gemini, Grok, Mistral and more behind the same OpenAI-compatible endpoint.",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    title: "Credits that never expire",
    desc: "Buy once, use whenever. Every plan also ships with free daily credits.",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: "Real-time analytics",
    desc: "Tokens, latency and cost per model with charts, history and an integrated playground.",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </svg>
    ),
  },
];

export function AuthHero() {
  return (
    <div className="relative mesh-hero hidden lg:flex flex-col justify-between p-10 xl:p-14 overflow-hidden">
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-14">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-bold"
            style={{
              background: "linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(139, 92, 246, 0.3))",
              border: "1px solid rgba(139, 92, 246, 0.25)",
              boxShadow: "0 0 40px -8px rgba(139, 92, 246, 0.4)",
            }}
          >
            <span className="aurora-text">A</span>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white/95">Aether Router</h1>
            <p className="text-[10px] text-[var(--text-dim)] tracking-[0.2em] uppercase">AI model proxy</p>
          </div>
        </div>

        <div className="max-w-md">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-5"
            style={{
              background: "rgba(139, 92, 246, 0.08)",
              border: "1px solid rgba(139, 92, 246, 0.15)",
            }}
          >
            <span className="live-dot" />
            <span className="text-[10px] text-emerald-300/90 uppercase tracking-[0.15em] font-medium">Proxy operational</span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-bold tracking-tight text-white/95 leading-[1.05]">
            One <span className="aurora-text">router</span> for <br /> all your models.
          </h2>
          <p className="mt-5 text-[15px] text-[var(--text-muted)] leading-relaxed">
            Access the best AI models through a unified API, credit-based pricing that never expires,
            and built-in observability tools.
          </p>

          <div className="mt-8 space-y-1">
            {features.map((f) => (
              <div key={f.title} className="feature-bullet">
                <div className="feature-bullet-icon">{f.icon}</div>
                <div>
                  <p className="text-sm font-medium text-white/90">{f.title}</p>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed mt-0.5 max-w-sm">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Provider marquee */}
      <div className="relative z-10 mt-10">
        <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.2em] mb-3">
          Supported providers
        </p>
        <div className="marquee-container">
          <div className="marquee">
            {[...providers, ...providers].map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-4 py-2 rounded-xl shrink-0"
                style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <span className={`w-2 h-2 rounded-full bg-gradient-to-br ${p.tone}`} />
                <span className="text-xs text-white/75 font-medium whitespace-nowrap">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
