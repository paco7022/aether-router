export function ProgressRing({
  progress,
  size = 88,
  stroke = 6,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="progress-ring">
        <defs>
          <linearGradient id="auroraGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
        </defs>
        <circle
          className="progress-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="progress-ring-indicator"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}
