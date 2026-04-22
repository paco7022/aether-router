type Tone = "cyan" | "violet" | "teal" | "emerald";

const toneColor: Record<Tone, { line: string; stop: string }> = {
  cyan: { line: "rgba(34, 211, 238, 0.9)", stop: "rgba(34, 211, 238, 0.35)" },
  violet: { line: "rgba(167, 139, 250, 0.9)", stop: "rgba(139, 92, 246, 0.32)" },
  teal: { line: "rgba(94, 234, 212, 0.9)", stop: "rgba(20, 184, 166, 0.3)" },
  emerald: { line: "rgba(110, 231, 183, 0.9)", stop: "rgba(52, 211, 153, 0.3)" },
};

export function Sparkline({
  data,
  tone = "cyan",
  width = 120,
  height = 36,
  className,
}: {
  data: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(data.length - 1, 1);
  const pad = 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(" ");

  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  const { line: stroke, stop } = toneColor[tone];
  const gradId = `spark-${tone}-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stop} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1][0]}
          cy={points[points.length - 1][1]}
          r="2.5"
          fill={stroke}
        />
      )}
    </svg>
  );
}
