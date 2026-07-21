/**
 * Health classification for the public status page (/status).
 *
 * Input is the per-model rollup from the `get_model_health` RPC (counts of
 * successful vs failed requests in usage_logs). We never actively probe the
 * providers — the status page is a read of real user traffic, so a model
 * nobody called simply reads as "no recent traffic" instead of pretending to
 * be healthy.
 *
 * Failure statuses are `error_<http status>` / `error_empty`, written by the
 * chat-completions route when the upstream call fails. Not every failure is
 * the provider's fault: a 400/404/422 usually means the *caller* sent
 * something the upstream rejected, so those are excluded from the health
 * verdict (they'd otherwise mark a healthy model as down whenever one user
 * sends a malformed request).
 */

export type HealthState = "operational" | "degraded" | "down" | "idle";

export type ModelHealthRow = {
  model_id: string;
  ok_recent: number;
  err_recent: number;
  ok_window: number;
  err_window: number;
  last_ok: string | null;
  last_err: string | null;
  last_err_code: string | null;
};

// HTTP statuses that mean "the request was bad", not "the provider is down".
const CLIENT_FAULT_CODES = new Set(["error_400", "error_404", "error_422"]);

export function isClientFault(code: string | null | undefined): boolean {
  return !!code && CLIENT_FAULT_CODES.has(code);
}

// Below this many observations we don't call anything down — a single failed
// request is noise (upstream hiccup, aborted stream, one bad prompt).
const MIN_SAMPLES_FOR_DOWN = 3;
// Share of failed requests that flips a model from degraded to down.
const DOWN_ERROR_RATIO = 0.8;
// Any failure rate above this is worth surfacing as degraded.
const DEGRADED_ERROR_RATIO = 0.2;

export type HealthVerdict = {
  state: HealthState;
  /** Which bucket the verdict was computed from. */
  basis: "recent" | "window" | "none";
  ok: number;
  errors: number;
};

/**
 * Classify one model. Prefers the recent bucket (last hour by default); if
 * nothing happened there, falls back to the wider window so a model that is
 * used a few times a day still reports something useful.
 */
export function classifyHealth(row: ModelHealthRow | undefined): HealthVerdict {
  if (!row) return { state: "idle", basis: "none", ok: 0, errors: 0 };

  const recentTotal = row.ok_recent + row.err_recent;
  const windowTotal = row.ok_window + row.err_window;

  if (recentTotal === 0 && windowTotal === 0) {
    return { state: "idle", basis: "none", ok: 0, errors: 0 };
  }

  const basis: "recent" | "window" = recentTotal > 0 ? "recent" : "window";
  const ok = basis === "recent" ? row.ok_recent : row.ok_window;
  const errors = basis === "recent" ? row.err_recent : row.err_window;
  const total = ok + errors;

  // Failures we've attributed to the caller rather than the provider don't
  // count against the model. We only know the *last* error code, so this is a
  // heuristic: if the only failures are client-fault and nothing succeeded,
  // stay neutral rather than crying outage.
  if (errors > 0 && ok === 0 && isClientFault(row.last_err_code)) {
    return { state: "idle", basis, ok, errors };
  }

  const errorRatio = errors / total;

  if (errors >= MIN_SAMPLES_FOR_DOWN && errorRatio >= DOWN_ERROR_RATIO) {
    return { state: "down", basis, ok, errors };
  }
  if (errors > 0 && errorRatio >= DEGRADED_ERROR_RATIO) {
    return { state: "degraded", basis, ok, errors };
  }
  if (ok > 0) {
    return { state: "operational", basis, ok, errors };
  }
  // Errors below the "down" sample floor and no successes yet: not enough
  // signal to accuse the provider.
  return { state: "degraded", basis, ok, errors };
}

export const STATE_LABEL: Record<HealthState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  idle: "No recent traffic",
};

/** Compact "2h ago" style label. Null timestamps render as an em dash. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const diffMs = now - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return "—";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Human label for an `error_<code>` status. */
export function errorCodeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "error_empty") return "empty response";
  const m = /^error_(\d{3})$/.exec(code);
  if (!m) return code;
  const status = m[1];
  const known: Record<string, string> = {
    "400": "bad request",
    "401": "upstream auth",
    "403": "upstream refused",
    "404": "model not found",
    "408": "timeout",
    "429": "rate limited",
    "500": "upstream error",
    "502": "bad gateway",
    "503": "unavailable",
    "504": "gateway timeout",
  };
  return known[status] ? `HTTP ${status} — ${known[status]}` : `HTTP ${status}`;
}
