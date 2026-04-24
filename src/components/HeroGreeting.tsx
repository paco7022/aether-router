import { ProgressRing } from "./ProgressRing";

function getGreeting(): { text: string; emoji: null } {
  const hour = new Date().getHours();
  if (hour < 5) return { text: "Burning the midnight oil", emoji: null };
  if (hour < 12) return { text: "Good morning", emoji: null };
  if (hour < 18) return { text: "Good afternoon", emoji: null };
  return { text: "Good evening", emoji: null };
}

export function HeroGreeting({
  displayName,
  totalCredits,
  dailyCredits,
  permanentCredits,
  planName,
  usagePctToday,
}: {
  displayName: string;
  totalCredits: number;
  dailyCredits: number;
  permanentCredits: number;
  planName?: string;
  usagePctToday: number;
}) {
  const greeting = getGreeting();
  const firstName = displayName.split(" ")[0] || displayName || "there";

  return (
    <div className="hero-card mb-8">
      <div className="hero-card-inner p-6 sm:p-7">
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          {/* Left: greeting + balance */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="live-dot" />
              <span className="text-[10px] text-emerald-300/80 uppercase tracking-[0.18em] font-medium">Proxy online</span>
              {planName && (
                <>
                  <span className="text-[var(--text-dim)]">&middot;</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium badge-violet">
                    {planName}
                  </span>
                </>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white/95 tracking-tight">
              {greeting.text},{" "}
              <span className="aurora-text">{firstName}</span>
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-1.5">
              Here&apos;s your account summary.
            </p>

            <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.15em] mb-1">Total balance</p>
                <p className="text-4xl sm:text-5xl font-bold aurora-text tracking-tight number-reveal">
                  {totalCredits.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  credits &middot; <span className="text-emerald-400/80">${(totalCredits / 10_000).toFixed(2)} USD</span>
                </p>
              </div>
              <div className="flex gap-4 pb-1">
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] text-teal-300/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                    Daily
                  </div>
                  <p className="text-sm font-semibold text-teal-200 mt-0.5">{dailyCredits.toLocaleString()}</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-300/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Permanent
                  </div>
                  <p className="text-sm font-semibold text-emerald-200 mt-0.5">{permanentCredits.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: progress ring */}
          <div className="flex items-center gap-5 shrink-0">
            <ProgressRing progress={usagePctToday} size={104} stroke={7}>
              <div>
                <p className="text-[9px] uppercase tracking-widest text-[var(--text-dim)] mb-0.5">Today</p>
                <p className="text-lg font-bold text-white/90">{Math.round(usagePctToday * 100)}%</p>
                <p className="text-[9px] text-[var(--text-muted)]">used</p>
              </div>
            </ProgressRing>
          </div>
        </div>
      </div>
    </div>
  );
}
