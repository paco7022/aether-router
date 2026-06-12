/**
 * Tiny in-process TTL cache for hot, rarely-changing DB lookups on the
 * chat-completions hot path (model rows, plan limits, ban decisions,
 * free-event misses).
 *
 * Why: every completion was costing ~8-9 Supabase roundtrips, several of
 * which re-read rows that only change on admin timescales (minutes). On the
 * shared NANO compute tier those reads burn the Disk IO budget that caused
 * the 2026-06-08 outage. A short TTL keeps staleness bounded (admin edits
 * apply within a minute or two per node) while eliminating the repeat reads.
 *
 * Per-process only: the PC node keeps one long-lived process; Cloudflare
 * isolates each get their own map (lower hit rate there, still correct).
 * Never cache errors or misses unless the call site explicitly opts in —
 * fail-closed paths must keep seeing real errors.
 */

type Entry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 5000
  ) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Bound memory: evict the oldest insertion when full. Entries are tiny
    // (plan/model rows), so 5000 keys is comfortably under a megabyte.
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
