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

export async function evaluateBanStatus(options: {
  headers: Headers;
  userId?: string | null;
  fingerprint?: string | null;
  adminClient?: ReturnType<typeof createAdminClient>;
}): Promise<BanDecision | null> {
  const admin = options.adminClient ?? createAdminClient();
  const ip = getClientIpFromHeaders(options.headers);
  const fingerprint = cleanFingerprint(options.fingerprint);

  const [fingerprintBan, ipBan] = await Promise.all([
    fingerprint
      ? admin
          .from("banned_fingerprints")
          .select("reason")
          .eq("fingerprint", fingerprint)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ip !== UNKNOWN_IP
      ? admin
          .from("banned_fingerprints")
          .select("reason")
          .eq("ip_address", ip)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (fingerprintBan.error || ipBan.error) {
    return {
      blocked: true,
      statusCode: 503,
      reason: "Unable to verify ban status right now. Please try again.",
      source: "check_error",
    };
  }

  if (fingerprintBan.data) {
    return {
      blocked: true,
      statusCode: 403,
      reason: fingerprintBan.data.reason || "Device fingerprint is banned.",
      source: "fingerprint",
    };
  }

  if (ipBan.data) {
    await autoBanFingerprintsLinkedToBannedIp({
      admin,
      userId: options.userId,
      ip,
      ipBanReason: ipBan.data.reason || null,
    });

    return {
      blocked: true,
      statusCode: 403,
      reason: ipBan.data.reason || "IP address is banned.",
      source: "ip",
    };
  }

  if (!options.userId) {
    return null;
  }

  const { data: identities, error: identityErr } = await admin
    .from("device_fingerprints")
    .select("fingerprint, ip_address")
    .eq("user_id", options.userId)
    .limit(256);

  if (identityErr) {
    return {
      blocked: true,
      statusCode: 503,
      reason: "Unable to verify account ban status right now. Please try again.",
      source: "check_error",
    };
  }

  const knownFingerprints = Array.from(
    new Set(
      (identities || [])
        .map((row) => cleanFingerprint(row.fingerprint))
        .filter((value): value is string => Boolean(value))
    )
  );

  const knownIps = Array.from(
    new Set(
      (identities || [])
        .map((row) => row.ip_address?.trim())
        .filter((value): value is string => Boolean(value && value !== UNKNOWN_IP))
    )
  );

  if (knownFingerprints.length > 0) {
    const { data: userFingerprintBan, error: userFingerprintBanErr } = await admin
      .from("banned_fingerprints")
      .select("reason")
      .in("fingerprint", knownFingerprints)
      .limit(1)
      .maybeSingle();

    if (userFingerprintBanErr) {
      return {
        blocked: true,
        statusCode: 503,
        reason: "Unable to verify account ban status right now. Please try again.",
        source: "check_error",
      };
    }

    if (userFingerprintBan) {
      return {
        blocked: true,
        statusCode: 403,
        reason: userFingerprintBan.reason || "This account is linked to a banned fingerprint.",
        source: "user_fingerprint",
      };
    }
  }

  if (knownIps.length > 0) {
    const { data: userIpBan, error: userIpBanErr } = await admin
      .from("banned_fingerprints")
      .select("reason")
      .in("ip_address", knownIps)
      .limit(1)
      .maybeSingle();

    if (userIpBanErr) {
      return {
        blocked: true,
        statusCode: 503,
        reason: "Unable to verify account ban status right now. Please try again.",
        source: "check_error",
      };
    }

    if (userIpBan) {
      return {
        blocked: true,
        statusCode: 403,
        reason: userIpBan.reason || "This account is linked to a banned IP address.",
        source: "user_ip",
      };
    }
  }

  return null;
}