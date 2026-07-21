"use client";

import { useCallback, useEffect, useState } from "react";
import { STATE_LABEL, timeAgo, errorCodeLabel, type HealthState } from "@/lib/model-health";

type StatusModel = {
  id: string;
  display_name: string;
  provider: string;
  state: HealthState;
  last_ok: string | null;
  last_error: string | null;
  last_error_code: string | null;
};

type StatusPayload = {
  generated_at: string;
  window_minutes: number;
  recent_minutes: number;
  refresh_seconds: number;
  summary: Record<HealthState, number>;
  models: StatusModel[];
};

const STATE_STYLE: Record<HealthState, { dot: string; text: string; border: string }> = {
  operational: { dot: "rgb(34, 197, 94)", text: "rgba(134, 239, 172, 0.95)", border: "rgba(34, 197, 94, 0.25)" },
  degraded: { dot: "rgb(251, 191, 36)", text: "rgba(253, 224, 71, 0.95)", border: "rgba(251, 191, 36, 0.25)" },
  down: { dot: "rgb(248, 113, 113)", text: "rgba(252, 165, 165, 0.95)", border: "rgba(248, 113, 113, 0.28)" },
  idle: { dot: "rgba(148, 163, 184, 0.7)", text: "rgba(148, 163, 184, 0.9)", border: "rgba(148, 163, 184, 0.18)" },
};

const STATE_ORDER: HealthState[] = ["down", "degraded", "operational", "idle"];

export default function StatusBoard() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // The payload itself only changes every 15 min (server-side cache), so
    // polling faster would just burn requests for an identical answer.
    const id = setInterval(load, 15 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return <p className="text-sm text-[var(--text-dim)]">Loading status…</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-red-300/90">Could not load status ({error ?? "no data"}).</p>;
  }

  const worst: HealthState =
    data.summary.down > 0 ? "down" : data.summary.degraded > 0 ? "degraded" : "operational";
  const headline =
    worst === "down"
      ? `${data.summary.down} model${data.summary.down === 1 ? "" : "s"} down`
      : worst === "degraded"
        ? `${data.summary.degraded} model${data.summary.degraded === 1 ? "" : "s"} degraded`
        : "All observed models operational";

  // Group by internal provider prefix (r/, sh/, bl/, k/ …) — that's the unit
  // that actually goes down together, since one reseller fronts many models.
  const groups = new Map<string, StatusModel[]>();
  for (const m of data.models) {
    const prefix = m.id.includes("/") ? m.id.split("/")[0] + "/" : m.provider;
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(m);
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      {/* Overall banner */}
      <div
        className="rounded-xl px-5 py-4 mb-6 flex items-center gap-3"
        style={{
          background: "rgba(255, 255, 255, 0.02)",
          border: `1px solid ${STATE_STYLE[worst].border}`,
        }}
      >
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: STATE_STYLE[worst].dot, boxShadow: `0 0 12px ${STATE_STYLE[worst].dot}` }}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: STATE_STYLE[worst].text }}>
            {headline}
          </p>
          <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
            Updated {timeAgo(data.generated_at)} · refreshes every {Math.round(data.refresh_seconds / 60)} min
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {STATE_ORDER.map((s) => (
          <span
            key={s}
            className="text-[11px] px-2.5 py-1 rounded-lg font-mono"
            style={{
              color: STATE_STYLE[s].text,
              border: `1px solid ${STATE_STYLE[s].border}`,
              background: "rgba(255, 255, 255, 0.02)",
            }}
          >
            {data.summary[s]} {STATE_LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>

      {orderedGroups.map(([prefix, models]) => (
        <section key={prefix} className="mb-8">
          <h2 className="text-xs uppercase tracking-[0.15em] text-[var(--text-dim)] mb-3 font-mono">
            {prefix}
          </h2>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(255, 255, 255, 0.06)" }}
          >
            {models.map((m, i) => {
              const style = STATE_STYLE[m.state];
              const errLabel = errorCodeLabel(m.last_error_code);
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-4 py-3 flex-wrap"
                  style={{
                    borderTop: i === 0 ? undefined : "1px solid rgba(255, 255, 255, 0.05)",
                    background: "rgba(255, 255, 255, 0.015)",
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: style.dot }}
                    aria-hidden
                  />
                  <span className="font-mono text-xs text-white/85 min-w-0 break-all">{m.id}</span>
                  <span className="text-[11px] text-[var(--text-dim)] hidden sm:inline">
                    {m.display_name}
                  </span>
                  <span className="ml-auto flex items-center gap-3 text-[11px]">
                    {m.state === "idle" ? null : (
                      <span className="text-[var(--text-dim)]">
                        last ok {timeAgo(m.last_ok)}
                        {m.last_error ? ` · last error ${timeAgo(m.last_error)}` : ""}
                        {m.state !== "operational" && errLabel ? ` (${errLabel})` : ""}
                      </span>
                    )}
                    <span style={{ color: style.text }}>{STATE_LABEL[m.state]}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
