import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HeroGreeting } from "@/components/HeroGreeting";
import { StatCard } from "@/components/StatCard";
import { QuickActions } from "@/components/QuickActions";
import { ModelAvatar } from "@/components/ModelAvatar";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [
    { data: profile },
    { data: recentUsage },
    { count: totalRequests },
    { data: activeKeys },
    { data: sevenDayLogs },
    { data: todayLogs },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("credits, daily_credits, display_name, plans(name)")
      .eq("id", user!.id)
      .single(),
    admin
      .from("usage_logs")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user!.id),
    supabase
      .from("api_keys")
      .select("id")
      .eq("user_id", user!.id)
      .eq("is_active", true),
    admin
      .from("usage_logs")
      .select("created_at, total_tokens, credits_charged, status")
      .eq("user_id", user!.id)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true }),
    admin
      .from("usage_logs")
      .select("credits_charged, total_tokens, status")
      .eq("user_id", user!.id)
      .gte("created_at", todayStart.toISOString()),
  ]);

  const permanentCredits = profile?.credits || 0;
  const dailyCredits = profile?.daily_credits || 0;
  const totalCredits = permanentCredits + dailyCredits;
  const displayName = profile?.display_name || (user?.email?.split("@")[0] ?? "there");
  const planName = (profile?.plans as { name: string } | null | undefined)?.name;

  // Build 7-day data
  const dayMap = new Map<string, { requests: number; tokens: number; credits: number }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().split("T")[0];
    dayMap.set(key, { requests: 0, tokens: 0, credits: 0 });
  }
  for (const log of sevenDayLogs || []) {
    const key = new Date(log.created_at).toISOString().split("T")[0];
    const entry = dayMap.get(key);
    if (entry) {
      entry.requests += 1;
      entry.tokens += log.total_tokens || 0;
      entry.credits += log.credits_charged || 0;
    }
  }
  const sevenDayData = Array.from(dayMap.values());
  const requestsSpark = sevenDayData.map((d) => d.requests);
  const tokensSpark = sevenDayData.map((d) => d.tokens);
  const creditsSpark = sevenDayData.map((d) => d.credits);

  const requests7d = requestsSpark.reduce((s, v) => s + v, 0);
  const tokens7d = tokensSpark.reduce((s, v) => s + v, 0);
  const credits7d = creditsSpark.reduce((s, v) => s + v, 0);

  // Prev week vs current week for trend (simple 3d vs prev 3d)
  const firstHalf = requestsSpark.slice(0, 3).reduce((s, v) => s + v, 0) || 1;
  const secondHalf = requestsSpark.slice(4, 7).reduce((s, v) => s + v, 0);
  const trendPct = ((secondHalf - firstHalf) / firstHalf) * 100;

  // Today's usage vs 7-day avg
  const creditsUsedToday = (todayLogs || []).reduce((s, r) => s + (r.credits_charged || 0), 0);
  const requestsToday = (todayLogs || []).length;
  const avgDailyCredits = credits7d / 7 || 1;
  const usagePctToday = Math.min(1, creditsUsedToday / Math.max(avgDailyCredits * 1.2, 1));

  // Success rate
  const successCount = (sevenDayLogs || []).filter((l) => l.status === "success").length;
  const successRate = sevenDayLogs && sevenDayLogs.length > 0 ? successCount / sevenDayLogs.length : 1;

  return (
    <div>
      <HeroGreeting
        displayName={displayName}
        totalCredits={totalCredits}
        dailyCredits={dailyCredits}
        permanentCredits={permanentCredits}
        planName={planName}
        usagePctToday={usagePctToday}
      />

      {/* Stats row — asymmetric */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Requests · 7d"
          value={requests7d}
          subtitle={`${requestsToday} hoy`}
          tone="cyan"
          sparkline={requestsSpark}
          trend={{ value: trendPct, positive: trendPct >= 0 }}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
        />
        <StatCard
          label="Tokens · 7d"
          value={tokens7d >= 1_000_000 ? `${(tokens7d / 1_000_000).toFixed(1)}M` : tokens7d >= 1_000 ? `${(tokens7d / 1_000).toFixed(1)}K` : tokens7d.toLocaleString()}
          subtitle={`${(totalRequests || 0).toLocaleString()} total`}
          tone="violet"
          sparkline={tokensSpark}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          }
        />
        <StatCard
          label="API Keys"
          value={activeKeys?.length || 0}
          subtitle="activas"
          tone="teal"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          }
        />
        <StatCard
          label="Success rate"
          value={`${(successRate * 100).toFixed(1)}%`}
          subtitle={successRate >= 0.95 ? "excelente" : successRate >= 0.85 ? "estable" : "revisar errores"}
          tone={successRate >= 0.95 ? "emerald" : successRate >= 0.85 ? "cyan" : "amber"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <QuickActions
          actions={[
            {
              href: "/dashboard/api-keys",
              label: "Crear API key",
              hint: "Genera credenciales",
              tone: "violet",
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(167, 139, 250, 0.95)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              ),
            },
            {
              href: "/dashboard/chat",
              label: "Probar en Chat",
              hint: "Playground integrado",
              tone: "cyan",
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(103, 232, 249, 0.95)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
            },
            {
              href: "/dashboard/billing",
              label: "Comprar créditos",
              hint: "Recarga permanente",
              tone: "teal",
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(94, 234, 212, 0.95)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              ),
            },
            {
              href: "/dashboard/docs",
              label: "Leer docs",
              hint: "Endpoints y ejemplos",
              tone: "emerald",
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(110, 231, 183, 0.95)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              ),
            },
          ]}
        />
      </div>

      {/* Activity + plan peek */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Timeline */}
        <div className="lg:col-span-2 glass-card shimmer-line overflow-hidden">
          <div className="p-5 border-b border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <h3 className="font-semibold text-white/90">Actividad reciente</h3>
            </div>
            <Link
              href="/dashboard/usage"
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors flex items-center gap-1"
            >
              Ver todo
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </div>

          {recentUsage && recentUsage.length > 0 ? (
            <div className="p-5">
              <ul className="timeline">
                {recentUsage.map((log) => (
                  <li key={log.id} className={`timeline-item ${log.status === "success" ? "success" : "error"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <ModelAvatar modelId={log.model_id} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono text-[12.5px] text-cyan-300/90 truncate">{log.model_id}</p>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              log.status === "success" ? "badge-success" : "badge-error"
                            }`}
                          >
                            {log.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                          {new Date(log.created_at).toLocaleString()}
                          {log.duration_ms ? <> · {(log.duration_ms / 1000).toFixed(1)}s</> : null}
                        </p>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <p className="text-sm font-semibold text-white/85">
                          {log.total_tokens?.toLocaleString() || 0}
                          <span className="text-[10px] text-[var(--text-dim)] font-normal ml-1">tok</span>
                        </p>
                        <p className="text-[11px] text-emerald-400/70 font-medium">
                          {log.credits_charged?.toLocaleString() || 0} cr
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="p-16 text-center">
              <div className="empty-halo mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(200, 200, 240, 0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <p className="text-sm font-medium text-white/70 mb-1">Aún no hay actividad</p>
              <p className="text-xs text-[var(--text-dim)] max-w-xs mx-auto mb-4">
                Crea una API key y empieza a hacer requests para ver tu historial aquí.
              </p>
              <Link href="/dashboard/api-keys" className="inline-flex items-center gap-2 btn-aurora px-4 py-2 text-xs font-medium">
                Crear API key
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>
          )}
        </div>

        {/* Usage pulse */}
        <div className="glass-card shimmer-line p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white/90">Pulso · 7 días</h3>
            <span className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">créditos/día</span>
          </div>

          <div className="space-y-3">
            {sevenDayData.map((d, i) => {
              const max = Math.max(...creditsSpark, 1);
              const pct = (d.credits / max) * 100;
              const date = new Date(sevenDaysAgo);
              date.setUTCDate(date.getUTCDate() + i);
              const dayLabel = date.toLocaleDateString("es", { weekday: "short" });
              const isToday = i === 6;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[11px] ${isToday ? "text-white font-medium" : "text-[var(--text-muted)]"} capitalize`}>
                      {dayLabel}
                      {isToday && <span className="ml-1.5 text-[9px] text-cyan-300/80 uppercase tracking-wider">hoy</span>}
                    </span>
                    <span className="text-[11px] text-white/70 font-mono">{d.credits.toLocaleString()}</span>
                  </div>
                  <div className="stat-bar">
                    <div
                      className="stat-bar-fill"
                      style={{
                        width: `${Math.max(pct, d.credits > 0 ? 3 : 0)}%`,
                        background: isToday
                          ? "linear-gradient(90deg, #22d3ee, #8b5cf6, #d946ef)"
                          : "linear-gradient(90deg, rgba(139, 92, 246, 0.5), rgba(34, 211, 238, 0.45))",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-white/[0.04] flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-0.5">Total 7d</p>
              <p className="text-lg font-bold aurora-text">{credits7d.toLocaleString()}</p>
            </div>
            <Link
              href="/dashboard/analytics"
              className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1"
            >
              Analytics
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-[var(--text-dim)] mt-6 leading-relaxed">
        Aether Router es un servicio proxy. No controlamos la disponibilidad, uptime ni calidad de salida de los modelos.
        El precio incluye un margen del 55% sobre el costo del proveedor para mantener el servicio.
      </p>
    </div>
  );
}
