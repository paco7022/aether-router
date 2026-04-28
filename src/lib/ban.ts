import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/client-ip";

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

export async function evaluateBanStatus(_options: {
  headers: Headers;
  userId?: string | null;
  fingerprint?: string | null;
  adminClient?: ReturnType<typeof createAdminClient>;
}): Promise<BanDecision | null> {
  return null;
}