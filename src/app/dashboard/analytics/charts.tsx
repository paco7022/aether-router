"use client";

import { useState } from "react";

type DailyPoint = {
  date: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  credits: number;
};

type ModelEntry = {
  model: string;
  requests: number;
  tokens: number;
};

// ── Aurora color palette for donut slices ──
const AURORA_COLORS = [
  "#22d3ee", // cyan
  "#8b5cf6", // violet
  "#d946ef", // magenta
  "#3b82f6", // blue
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#ef4444", // red
  "#34d399", // emerald
];

// ── SVG Area Chart ──
function AreaChart({
  data,
  valueKey,
  label,
  color,
  gradientId,
}: {
  data: DailyPoint[];
  valueKey: keyof DailyPoint;
  label: string;
  color: string;
  gradientId: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const values = data.map((d) => Number(d[valueKey]));
  const max = Math.max(...values, 1);
  const labels = data.map((d) =>
    new Date(d.date + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric" })
  );

  const W = 560;
  const H = 200;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const points = values.map((v, i) => ({
    x: padL + (i / Math.max(values.length - 1, 1)) * chartW,
    y: padT + chartH - (v / max) * chartH,
    value: v,
    label: labels[i],
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

  // Y-axis ticks (5 lines)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = (max / 4) * i;
    const y = padT + chartH - (val / max) * chartH;
    return { y, label: formatCompact(val) };
  });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id={`${gradientId}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.6" />
            <stop offset="50%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={tick.y}
              x2={W - padR}
              y2={tick.y}
              stroke="rgba(255,255,255,0.04)"
              strokeDasharray={i === 0 ? "none" : "4 4"}
            />
            <text
              x={padL - 8}
              y={tick.y + 3}
              textAnchor="end"
              fill="rgba(255,255,255,0.25)"
              fontSize="9"
              fontFamily="monospace"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={`url(#${gradientId}-line)`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Glow line (wider, blurred effect) */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.1"
        />

        {/* X-axis labels (show every other for 14 days) */}
        {points.map((p, i) =>
          i % 2 === 0 || i === points.length - 1 ? (
            <text
              key={i}
              x={p.x}
              y={H - 6}
              textAnchor="middle"
              fill="rgba(255,255,255,0.25)"
              fontSize="8"
              fontFamily="monospace"
            >
              {p.label}
            </text>
          ) : null
        )}

        {/* Interactive dots + hover zones */}
        {points.map((p, i) => (
          <g
            key={i}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{ cursor: "crosshair" }}
          >
            {/* Hit area */}
            <rect
              x={p.x - chartW / values.length / 2}
              y={padT}
              width={chartW / values.length}
              height={chartH}
              fill="transparent"
            />

            {/* Vertical guide line on hover */}
            {hoveredIndex === i && (
              <line
                x1={p.x}
                y1={padT}
                x2={p.x}
                y2={padT + chartH}
                stroke={color}
                strokeWidth="1"
                opacity="0.2"
                strokeDasharray="3 3"
              />
            )}

            {/* Dot */}
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredIndex === i ? 4 : 2.5}
              fill={hoveredIndex === i ? color : "rgba(0,0,0,0.6)"}
              stroke={color}
              strokeWidth={hoveredIndex === i ? 2 : 1.5}
              style={{ transition: "r 0.15s, fill 0.15s" }}
            />

            {/* Glow on hover */}
            {hoveredIndex === i && (
              <circle cx={p.x} cy={p.y} r="10" fill={color} opacity="0.12" />
            )}

            {/* Tooltip */}
            {hoveredIndex === i && (
              <g>
                <rect
                  x={Math.min(Math.max(p.x - 40, 4), W - 84)}
                  y={Math.max(p.y - 34, 2)}
                  width="80"
                  height="22"
                  rx="6"
                  fill="rgba(10, 10, 30, 0.92)"
                  stroke={color}
                  strokeWidth="0.5"
                  strokeOpacity="0.4"
                />
                <text
                  x={Math.min(Math.max(p.x, 44), W - 44)}
                  y={Math.max(p.y - 19, 17)}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.85)"
                  fontSize="10"
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  {formatCompact(p.value)}
                </text>
              </g>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Donut Chart ──
function DonutChart({ data }: { data: ModelEntry[] }) {
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);

  const total = data.reduce((s, d) => s + d.requests, 0);
  if (total === 0) return null;

  const cx = 90;
  const cy = 90;
  const r = 70;
  const innerR = 46;

  let startAngle = -90;
  const slices = data.map((d, i) => {
    const angle = (d.requests / total) * 360;
    const endAngle = startAngle + angle;
    const midAngle = ((startAngle + endAngle) / 2) * (Math.PI / 180);

    const largeArc = angle > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180);
    const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180);
    const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180);
    const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180);
    const ix1 = cx + innerR * Math.cos((startAngle * Math.PI) / 180);
    const iy1 = cy + innerR * Math.sin((startAngle * Math.PI) / 180);
    const ix2 = cx + innerR * Math.cos((endAngle * Math.PI) / 180);
    const iy2 = cy + innerR * Math.sin((endAngle * Math.PI) / 180);

    const path =
      angle >= 359.9
        ? // Full circle (avoid SVG arc rendering issues)
          [
            `M ${cx + r} ${cy}`,
            `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
            `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
            `M ${cx + innerR} ${cy}`,
            `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
            `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`,
          ].join(" ")
        : [
            `M ${x1} ${y1}`,
            `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
            `L ${ix2} ${iy2}`,
            `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`,
            `Z`,
          ].join(" ");

    startAngle = endAngle;

    return {
      path,
      color: AURORA_COLORS[i % AURORA_COLORS.length],
      model: d.model,
      requests: d.requests,
      tokens: d.tokens,
      pct: ((d.requests / total) * 100).toFixed(1),
      midAngle,
    };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 180 180" className="w-44 h-44 shrink-0">
        <defs>
          {slices.map((s, i) => (
            <radialGradient key={i} id={`donut-grad-${i}`} cx="50%" cy="50%" r="50%">
              <stop offset="30%" stopColor={s.color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.6" />
            </radialGradient>
          ))}
        </defs>
        {slices.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill={`url(#donut-grad-${i})`}
            stroke="rgba(5, 5, 16, 0.8)"
            strokeWidth="1.5"
            opacity={hoveredSlice === null || hoveredSlice === i ? 1 : 0.35}
            onMouseEnter={() => setHoveredSlice(i)}
            onMouseLeave={() => setHoveredSlice(null)}
            style={{ cursor: "pointer", transition: "opacity 0.2s" }}
          />
        ))}
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="18" fontWeight="700">
          {total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace">
          requests
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 min-w-0">
        {slices.map((s, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-xs group/legend"
            onMouseEnter={() => setHoveredSlice(i)}
            onMouseLeave={() => setHoveredSlice(null)}
            style={{ cursor: "pointer" }}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{
                background: s.color,
                boxShadow: hoveredSlice === i ? `0 0 8px ${s.color}` : "none",
                transition: "box-shadow 0.2s",
              }}
            />
            <span
              className="font-mono truncate max-w-[140px]"
              style={{
                color: hoveredSlice === i ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
                transition: "color 0.15s",
              }}
            >
              {s.model}
            </span>
            <span className="text-[var(--text-dim)] ml-auto tabular-nums pl-2">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helper ──
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Main export ──
export function AnalyticsCharts({
  dailyData,
  modelBreakdown,
}: {
  dailyData: DailyPoint[];
  modelBreakdown: ModelEntry[];
}) {
  const hasData = dailyData.some((d) => d.requests > 0);

  if (!hasData) {
    return (
      <div className="glass-card shimmer-line p-16 text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(34, 211, 238, 0.08))",
            border: "1px solid rgba(139, 92, 246, 0.1)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
          </svg>
        </div>
        <p className="text-sm font-medium text-white/60 mb-1">No analytics data yet</p>
        <p className="text-xs text-[var(--text-dim)] max-w-xs mx-auto">
          Start making API requests to see your usage trends here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests chart */}
        <div className="glass-card shimmer-line overflow-hidden">
          <div className="p-4 pb-0 border-b border-white/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#3b82f6", boxShadow: "0 0 8px rgba(59, 130, 246, 0.4)" }}
              />
              <h3 className="text-sm font-semibold text-white/80">Requests per Day</h3>
            </div>
          </div>
          <div className="p-4">
            <AreaChart
              data={dailyData}
              valueKey="requests"
              label="Requests"
              color="#3b82f6"
              gradientId="req-grad"
            />
          </div>
        </div>

        {/* Tokens chart */}
        <div className="glass-card shimmer-line overflow-hidden">
          <div className="p-4 pb-0 border-b border-white/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#22d3ee", boxShadow: "0 0 8px rgba(34, 211, 238, 0.4)" }}
              />
              <h3 className="text-sm font-semibold text-white/80">Tokens per Day</h3>
            </div>
          </div>
          <div className="p-4">
            <AreaChart
              data={dailyData}
              valueKey="tokens"
              label="Tokens"
              color="#22d3ee"
              gradientId="tok-grad"
            />
          </div>
        </div>
      </div>

      {/* Bottom row: Model breakdown + Credits chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model breakdown donut */}
        <div className="glass-card shimmer-line overflow-hidden">
          <div className="p-4 pb-0 border-b border-white/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#8b5cf6", boxShadow: "0 0 8px rgba(139, 92, 246, 0.4)" }}
              />
              <h3 className="text-sm font-semibold text-white/80">Model Breakdown</h3>
              <span className="text-[10px] text-[var(--text-dim)] ml-auto">by requests</span>
            </div>
          </div>
          <div className="p-5">
            {modelBreakdown.length > 0 ? (
              <DonutChart data={modelBreakdown} />
            ) : (
              <p className="text-xs text-[var(--text-dim)] text-center py-8">No model data</p>
            )}
          </div>
        </div>

        {/* Credits chart */}
        <div className="glass-card shimmer-line overflow-hidden">
          <div className="p-4 pb-0 border-b border-white/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#34d399", boxShadow: "0 0 8px rgba(52, 211, 153, 0.4)" }}
              />
              <h3 className="text-sm font-semibold text-white/80">Credits Consumed</h3>
            </div>
          </div>
          <div className="p-4">
            <AreaChart
              data={dailyData}
              valueKey="credits"
              label="Credits"
              color="#34d399"
              gradientId="cred-grad"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
