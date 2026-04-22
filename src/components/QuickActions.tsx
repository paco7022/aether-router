import Link from "next/link";

type Action = {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone: "violet" | "cyan" | "teal" | "emerald";
};

const toneBg: Record<Action["tone"], string> = {
  violet: "linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(139, 92, 246, 0.06))",
  cyan: "linear-gradient(135deg, rgba(34, 211, 238, 0.16), rgba(34, 211, 238, 0.05))",
  teal: "linear-gradient(135deg, rgba(20, 184, 166, 0.16), rgba(20, 184, 166, 0.05))",
  emerald: "linear-gradient(135deg, rgba(52, 211, 153, 0.16), rgba(52, 211, 153, 0.05))",
};

const toneBorder: Record<Action["tone"], string> = {
  violet: "rgba(139, 92, 246, 0.22)",
  cyan: "rgba(34, 211, 238, 0.2)",
  teal: "rgba(20, 184, 166, 0.2)",
  emerald: "rgba(52, 211, 153, 0.2)",
};

export function QuickActions({ actions }: { actions: Action[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {actions.map((a) => (
        <Link key={a.href} href={a.href} className="action-tile">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: toneBg[a.tone], border: `1px solid ${toneBorder[a.tone]}` }}
          >
            {a.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white/90 truncate">{a.label}</p>
            <p className="text-[11px] text-[var(--text-muted)] truncate">{a.hint}</p>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--text-dim)] shrink-0 transition-transform group-hover:translate-x-0.5"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      ))}
    </div>
  );
}
