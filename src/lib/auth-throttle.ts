/**
 * Per-IP throttle for repeated API-key authentication FAILURES.
 *
 * Every Bearer that isn't in `api_keys` costs one Supabase SELECT. The
 * negative cache in lib/auth.ts absorbs a client looping on one stale key, but
 * it does nothing against a flood of *random* keys: each hash is new, so each
 * one reaches the DB. That is a cheap way to burn the shared compute's Disk IO
 * budget — the same resource that caused the 2026-06-08 outage.
 *
 * Only failures are counted, so legitimate traffic never touches this path: a
 * valid key never increments the counter, and heavy agent bursts (Claude Code,
 * SillyTavern) are unaffected. That's why this lives here and not as a blanket
 * request-rate limit on /v1/chat/completions, which would break real users.
 *
 * Scope: per-process, like the other in-memory limiters in this codebase
 * (chat upload, edge worker). The PC node has one long-lived process; each
 * Cloudflare isolate keeps its own map, so the effective threshold there is
 * per-isolate. It raises the cost of the attack by orders of magnitude without
 * a DB write per attempt — a durable counter would reintroduce the very write
 * load this is meant to avoid.
 */

const WINDOW_MS = 60_000;
// Failures tolerated per IP per window before it is put in timeout. Generous:
// a human rotating a broken key by hand will never reach it.
const MAX_FAILURES = 20;
const BLOCK_MS = 60_000;
const MAX_TRACKED_IPS = 50_000;

type Entry = { failures: number; windowEndsAt: number; blockedUntil: number };

const ipFailures = new Map<string, Entry>();

function prune(now: number): void {
  if (ipFailures.size < MAX_TRACKED_IPS) return;
  for (const [ip, entry] of ipFailures) {
    if (entry.blockedUntil < now && entry.windowEndsAt < now) ipFailures.delete(ip);
  }
}

/**
 * Seconds the caller must wait, or 0 when it is not being throttled.
 * `unknown` (no proxy header) is never throttled: every such client would
 * share one bucket, so one bad actor could lock out the rest.
 */
export function authFailureRetryAfter(ip: string): number {
  if (!ip || ip === "unknown") return 0;
  const entry = ipFailures.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.blockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
}

export function recordAuthFailure(ip: string): void {
  if (!ip || ip === "unknown") return;
  const now = Date.now();
  prune(now);

  const entry = ipFailures.get(ip);
  if (!entry || entry.windowEndsAt <= now) {
    ipFailures.set(ip, { failures: 1, windowEndsAt: now + WINDOW_MS, blockedUntil: 0 });
    return;
  }

  entry.failures += 1;
  if (entry.failures > MAX_FAILURES) {
    entry.blockedUntil = now + BLOCK_MS;
    // Restart the counting window so the block doesn't extend itself forever
    // off stale failures once the caller backs off.
    entry.failures = 0;
    entry.windowEndsAt = now + WINDOW_MS;
  }
}

/** Test seam — resets the process-local state. */
export function resetAuthThrottle(): void {
  ipFailures.clear();
}
