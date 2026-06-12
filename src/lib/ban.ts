import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/client-ip";
import { TtlCache } from "@/lib/db-cache";

type BanSource =
  | "fingerprint"
  | "ip"
  | "user_fingerprint"
  | "user_ip"
  | "check_error";

export type BanDecision = {
  blocked: boolean;
  statusCode: 403 | 503;
  reason: string;
  source: BanSource;
};

const UNKNOWN_IP = "unknown";

type AutoIpFingerprintBanRow = {
  fingerprint: string;
  ip_address?: string | null;
  reason: string;
  banned_by: string;
};

export function getClientIpFromHeaders(headers: Headers): string {
  // Delegates to the central proxy-aware helper so every code path shares
  // the same trust model. Do not resurrect `.split(",")[0]` here — it was
  // spoofable: clients can inject `X-Forwarded-For: 1.2.3.4` and reset
  // their apparent IP at will.
  return getClientIp(headers);
}

/**
 * Normalize a client-supplied fingerprint so comparison against the ban
 * table is deterministic. The header is attacker-controlled, so:
 *   - lowercase (banned `abc123` must still match `ABC123`)
 *   - strip invisible / zero-width chars that would defeat `eq()`
 *   - cap length to protect the index
 */
function cleanFingerprint(fingerprint: string | null | undefined): string | null {
  if (!fingerprint) return null;
  // eslint-disable-next-line no-misleading-character-class
  const cleaned = fingerprint
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, "")
    .trim()
    .toLowerCase()
    .slice(0, 256);
  return cleaned.length > 0 ? cleaned : null;
}

export function buildAutoIpLinkedFingerprintBanRows(options: {
  fingerprints: string[];
  ip: string;
  ipBanReason: string | null;
}): AutoIpFingerprintBanRow[] {
  const uniqueFingerprints = Array.from(
    new Set(
      options.fingerprints
        .map((value) => cleanFingerprint(value))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (uniqueFingerprints.length === 0) {
    return [];
  }

  const reason = options.ipBanReason?.trim()
    ? `Auto-ban by IP association: ${options.ipBanReason.trim()}`
    : "Auto-ban by IP association with a banned IP.";

  const ipAddress = options.ip !== UNKNOWN_IP ? options.ip : null;

  return uniqueFingerprints.map((fp) => ({
    fingerprint: fp,
    ip_address: ipAddress,
    reason,
    banned_by: "system:auto-ip-link",
  }));
}

async function autoBanFingerprintsLinkedToBannedIp(options: {
  admin: ReturnType<typeof createAdminClient>;
  userId?: string | null;
  // NOTE: We deliberately do NOT take the request-supplied fingerprint here.
  // That header is attacker-controlled; previously an attacker with a banned
  // IP could submit a victim's fingerprint and have it auto-added to the
  // ban table, framing the victim. We only auto-link fingerprints that the
  // server itself observed in `device_fingerprints` for this userId.
  ip: string;
  ipBanReason: string | null;
}) {
  if (!options.userId) {
    // No trusted source of linked fingerprints — skip the auto-propagation.
    // The top-level IP ban still blocks the current request.
    return;
  }
  const candidates: string[] = [];

  const { data: identities, error } = await options.admin
    .from("device_fingerprints")
    .select("fingerprint")
    .eq("user_id", options.userId)
    .limit(256);

  if (error) {
    console.error("Failed to fetch user fingerprints for auto IP-linked banning:", error.message);
  } else {
    for (const row of identities || []) {
      const fp = cleanFingerprint(row.fingerprint);
      if (fp) candidates.push(fp);
    }
  }

  const rows = buildAutoIpLinkedFingerprintBanRows({
    fingerprints: candidates,
    ip: options.ip,
    ipBanReason: options.ipBanReason,
  });

  if (rows.length === 0) {
    return;
  }

  const { error: upsertError } = await options.admin
    .from("banned_fingerprints")
    .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true });

  if (upsertError) {
    console.error("Failed to auto-ban fingerprints linked to banned IP:", upsertError.message);
  }
}

/**
 * Decide whether the current request should be blocked because the device
 * fingerprint or client IP (directly supplied, or server-observed for this
 * userId) appears in `banned_fingerprints`.
 *
 * Returns a `BanDecision` when blocked, or `null` to let the request through.
 *
 * Fail-open: on any DB error we log and return `null`. A transient Supabase
 * hiccup must not 503/403 every user at once — bans are an anti-abuse control,
 * not a hard security boundary, and `banned_fingerprints` is only writable by
 * service_role anyway. Availability wins over a momentarily-missed ban.
 */
// Ban decisions are cached per (userId, ip, fingerprint) for 60s. The check
// previously cost three DB reads on EVERY completion request; ban-table edits
// are rare, and a ≤60s propagation delay per node is acceptable for an
// anti-abuse control that already fails open on DB errors. Only decisions
// computed from real data are cached — error fail-opens bypass the cache so
// a transient outage can't pin a stale "allow" (or "block") for the TTL.
const banDecisionCache = new TtlCache<BanDecision | null>(60_000);

export async function evaluateBanStatus(options: {
  headers: Headers;
  userId?: string | null;
  fingerprint?: string | null;
  adminClient?: ReturnType<typeof createAdminClient>;
}): Promise<BanDecision | null> {
  const admin = options.adminClient ?? createAdminClient();
  const ip = getClientIpFromHeaders(options.headers);
  const requestFp = cleanFingerprint(options.fingerprint);

  const cacheKey = `${options.userId ?? ""}|${ip}|${requestFp ?? ""}`;
  const cachedDecision = banDecisionCache.get(cacheKey);
  if (cachedDecision !== undefined) {
    return cachedDecision;
  }

  // Fingerprints / IPs to test: the request-supplied ones plus anything the
  // server itself recorded for this user in `device_fingerprints`. The request
  // header is attacker-controlled, but checking it can only ever *add* a match
  // (an attacker won't volunteer a banned fingerprint), so it's safe to include.
  const fingerprints = new Set<string>();
  const userFingerprints = new Set<string>();
  const ips = new Set<string>();
  const userIps = new Set<string>();

  if (requestFp) fingerprints.add(requestFp);
  if (ip && ip !== UNKNOWN_IP) ips.add(ip);

  if (options.userId) {
    const { data: identities, error } = await admin
      .from("device_fingerprints")
      .select("fingerprint, ip_address")
      .eq("user_id", options.userId)
      .limit(256);

    if (error) {
      console.error("evaluateBanStatus: failed to load device fingerprints:", error.message);
      return null; // fail-open
    }

    for (const row of identities || []) {
      const fp = cleanFingerprint(row.fingerprint);
      if (fp) {
        fingerprints.add(fp);
        userFingerprints.add(fp);
      }
      const rowIp = row.ip_address?.trim();
      if (rowIp && rowIp !== UNKNOWN_IP) {
        ips.add(rowIp);
        userIps.add(rowIp);
      }
    }
  }

  if (fingerprints.size === 0 && ips.size === 0) {
    banDecisionCache.set(cacheKey, null);
    return null;
  }

  // Two targeted lookups beat one fragile `.or()` string. Fingerprint match
  // takes precedence over IP (more specific / less collateral).
  if (fingerprints.size > 0) {
    const { data, error } = await admin
      .from("banned_fingerprints")
      .select("fingerprint, reason")
      .in("fingerprint", Array.from(fingerprints))
      .limit(1);

    if (error) {
      console.error("evaluateBanStatus: fingerprint lookup failed:", error.message);
      return null; // fail-open
    }
    const hit = data?.[0];
    if (hit) {
      const isRequestFp = hit.fingerprint === requestFp && !userFingerprints.has(hit.fingerprint);
      const decision: BanDecision = {
        blocked: true,
        statusCode: 403,
        reason: hit.reason?.trim() || "This device has been banned.",
        source: isRequestFp ? "fingerprint" : "user_fingerprint",
      };
      banDecisionCache.set(cacheKey, decision);
      return decision;
    }
  }

  if (ips.size > 0) {
    const { data, error } = await admin
      .from("banned_fingerprints")
      .select("ip_address, reason")
      .in("ip_address", Array.from(ips))
      .limit(1);

    if (error) {
      console.error("evaluateBanStatus: ip lookup failed:", error.message);
      return null; // fail-open
    }
    const hit = data?.[0];
    if (hit) {
      // Propagate the IP ban to fingerprints the server has observed for this
      // user, so they stay blocked even after rotating IPs. Best-effort; never
      // blocks the response on it.
      if (options.userId) {
        await autoBanFingerprintsLinkedToBannedIp({
          admin,
          userId: options.userId,
          ip,
          ipBanReason: hit.reason ?? null,
        }).catch((err) => {
          console.error("evaluateBanStatus: auto IP-link propagation failed:", err);
        });
      }
      const isRequestIp = hit.ip_address === ip && !userIps.has(hit.ip_address ?? "");
      const decision: BanDecision = {
        blocked: true,
        statusCode: 403,
        reason: hit.reason?.trim() || "Access from this network has been blocked.",
        source: isRequestIp ? "ip" : "user_ip",
      };
      banDecisionCache.set(cacheKey, decision);
      return decision;
    }
  }

  banDecisionCache.set(cacheKey, null);
  return null;
}