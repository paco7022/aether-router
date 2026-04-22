import { Sparkline } from "./Sparkline";

type Tone = "cyan" | "violet" | "teal" | "emerald" | "amber";

const toneStyles: Record<Tone, { icon: string; border: string; glow: string; text: string; spark: "cyan" | "violet" | "teal" | "emerald" }> = {
  cyan: {
    icon: "rgba(34, 211, 238, 0.7)",
    border: "rgba(34, 211, 238, 0.12)",
    glow: "glow-cyan",
    text: "text-cyan-400/70",
    spark: "cyan",
  },
  violet: {
    icon: "rgba(139, 92, 246, 0.7)",
    border: "rgba(139, 92, 246, 0.12)",
    glow: "glow-violet",
    text: "text-violet-400/70",
    spark: "violet",
  },
  teal: {
    icon: "rgba(20, 184, 166, 0.7)",
    border: "rgba(20, 184, 166, 0.12)",
    glow: "glow-cyan",
    text: "text-teal-400/70",
    spark: "teal",
  },
  emerald: {
    icon: "rgba(52, 211, 153, 0.7)",
    border: "rgba(52, 211, 153, 0.12)",
    glow: "glow-green",
    text: "text-emerald-400/70",
    spark: "emerald",
  },
  amber: {
    icon: "rgba(251, 191, 36, 0.8)",
    border: "rgba(251, 191, 36, 0.14)",
    glow: "",
    text: "text-amber-400/70",
    spark: "violet",
  },
};

export function StatCard({
  label,
  value,
  subtitle,
  tone,
  icon,
  sparkline,
  trend,
  featured,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  tone: Tone;
  icon: React.ReactNode;
  sparkline?: number[];
  trend?: { value: number; positive?: boolean };
  featured?: boolean;
}) {
  const t = toneStyles[tone];

  return (
    <div className={`glass-card aurora-border shimmer-line p-5 ${t.glow} group ${featured ? "col-span-1 sm:col-span-2" : ""}`}>
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">{label}</p>
        <div
          className="stat-icon"
          style={{
            background: `color-mix(in srgb, ${t.icon} 12%, transparent)`,
            border: `1px solid ${t.border}`,
            color: t.icon,
          }}
        >
          {icon}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={`${featured ? "text-4xl" : "text-3xl"} font-bold text-white/90 tracking-tight number-reveal`}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            {subtitle && (
              <p className={`text-sm ${t.text} font-medium`}>{subtitle}</p>
            )}
            {trend && (
              <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
                trend.positive === false ? "text-red-400/80" : "text-emerald-400/80"
              }`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{
                  transform: trend.positive === false ? "rotate(180deg)" : undefined,
                }}>
                  <polyline points="6 15 12 9 18 15" />
                </svg>
                {Math.abs(trend.value).toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {sparkline && sparkline.length > 0 && (
          <div className="shrink-0 opacity-85 group-hover:opacity-100 transition-opacity">
            <Sparkline
              data={sparkline}
              tone={t.spark}
              width={featured ? 140 : 96}
              height={featured ? 44 : 36}
            />
          </div>
        )}
      </div>
    </div>
  );
}
