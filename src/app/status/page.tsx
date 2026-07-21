import type { Metadata } from "next";
import Link from "next/link";
import StatusBoard from "./status-board";

export const metadata: Metadata = {
  title: "Status | Aether Router",
  description: "Live health of every model served by Aether Router.",
};

export default function StatusPage() {
  return (
    <div className="min-h-screen relative">
      {/* Aurora background */}
      <div className="aurora-bg">
        <div className="aurora-orb-1" />
        <div className="aurora-orb-2" />
      </div>
      <div className="noise-overlay" />

      <main className="relative z-10 max-w-3xl mx-auto px-6 py-12 lg:py-16">
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition-colors mb-6"
          >
            <span className="font-mono">&larr;</span> Back to Aether Router
          </Link>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-white/90">Status</h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            Health is derived from real traffic over the last 24 hours — we don&apos;t send
            synthetic probes. A model nobody has called recently shows as{" "}
            <span className="text-[var(--text)]">no recent traffic</span> rather than a guess.
            The snapshot is recomputed every 15 minutes.
          </p>
        </div>

        <StatusBoard />

        <p className="text-[11px] text-[var(--text-dim)] mt-10 leading-relaxed">
          Aether Router routes through third-party providers we do not own. Upstream outages are
          usually transient — if a model shows as down, try another provider prefix for the same
          model family. Malformed-request errors (HTTP 400/404/422) are excluded from the verdict,
          since those come from the caller rather than the provider.
        </p>
      </main>
    </div>
  );
}
