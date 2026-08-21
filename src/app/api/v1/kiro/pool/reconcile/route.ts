import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Auto-removal reconciler for the Kiro community pool. Polls the gateway's
// per-account health and evicts accounts that have died (high circuit-breaker
// failure count or vanished from the gateway), freeing their slot in the DB.
//
// Triggered on a schedule by a tiny curl from the VPS (systemd timer). Auth is
// the shared POOL_ADMIN_SECRET. Only accounts tracked in kiro_pool_accounts are
// managed here — the owner's seed account is never touched.

const DEAD_THRESHOLD = Number(process.env.KIRO_POOL_DEAD_THRESHOLD) || 6;

function gatewayAdminBase(): string | null {
  const explicit = process.env.KIRO_ADMIN_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = process.env.KIRO_BASE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "").replace(/\/v1$/, "");
}

interface GatewayAccount {
  filename: string;
  failures: number;
  initialized: boolean;
}

interface GatewayHealth {
  filename: string;
  alive: boolean;
  error: string | null;
}

// Reservations abandoned mid-capture (see the contribute route) never get
// released and are skipped by the eviction pass below, so they'd hold a slot
// forever. Clear them on every cycle.
const PENDING_TTL_MS = 10 * 60 * 1000;

async function sweepStalePending(
  admin: ReturnType<typeof createAdminClient>
): Promise<number> {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("kiro_pool_accounts")
    .delete()
    .eq("status", "active")
    .eq("filename", "pending")
    .lt("created_at", cutoff)
    .select("id");
  if (error) {
    console.error("kiro reconcile: pending sweep failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export async function POST(req: NextRequest) {
  const secret = process.env.POOL_ADMIN_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminBase = gatewayAdminBase();
  if (!adminBase) {
    return NextResponse.json({ error: "gateway not configured" }, { status: 503 });
  }

  // Pull current health from the gateway.
  let gwAccounts: GatewayAccount[] = [];
  try {
    const res = await fetch(`${adminBase}/admin/pool/list`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `gateway list ${res.status}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { accounts?: GatewayAccount[] };
    gwAccounts = data.accounts ?? [];
  } catch (e) {
    return NextResponse.json(
      { error: `gateway unreachable: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  const health = new Map<string, GatewayAccount>();
  for (const a of gwAccounts) health.set(a.filename, a);

  // `failures` is a circuit-breaker counter and stays at 0 for the failure mode
  // that actually kills the pool: a desynced/revoked token that 401s on
  // refresh. Ask the gateway for real liveness instead; older gateways don't
  // serve this endpoint, so treat a failure here as "no extra signal".
  const liveness = new Map<string, boolean>();
  try {
    const res = await fetch(`${adminBase}/admin/pool/health`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const data = (await res.json()) as { accounts?: GatewayHealth[] };
      for (const a of data.accounts ?? []) liveness.set(a.filename, a.alive);
    }
  } catch {
    // Probe unavailable — fall back to the failure counter alone.
  }

  const admin = createAdminClient();
  const pendingSwept = await sweepStalePending(admin);
  const { data: rows, error } = await admin
    .from("kiro_pool_accounts")
    .select("id, filename")
    .eq("status", "active")
    .neq("filename", "pending");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const evicted: string[] = [];
  const tracked = new Set<string>();
  for (const row of rows ?? []) {
    tracked.add(row.filename);
    const h = health.get(row.filename);
    let dead: string | null = null;
    if (!h) {
      dead = "missing_from_gateway";
    } else if (liveness.get(row.filename) === false) {
      dead = "refresh_401";
    } else if (h.failures >= DEAD_THRESHOLD) {
      dead = `failures_${h.failures}`;
    }
    if (!dead) continue;

    // Tell the gateway to retire the file (idempotent), then free the DB slot.
    try {
      await fetch(`${adminBase}/admin/pool/remove`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: row.filename }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      // Even if the gateway call fails, mark dead so the slot frees; the file
      // move is idempotent and can be retried next cycle.
    }
    await admin.rpc("mark_kiro_pool_dead", {
      p_filename: row.filename,
      p_reason: dead,
    });
    evicted.push(row.filename);
  }

  // Accounts added straight through the gateway (the owner's own, or anything
  // captured with POOL_ADMIN_SECRET) have no row here, so the loop above can
  // never retire them. A dead one is not harmless: the gateway scans accounts
  // in filename order and does not fail over on a refresh 401, so whichever
  // dead account sorts first returns 500 for every k/ request. Retire the ones
  // the liveness probe says are gone.
  const orphansRetired: string[] = [];
  for (const [filename, alive] of liveness) {
    if (alive || tracked.has(filename)) continue;
    try {
      const res = await fetch(`${adminBase}/admin/pool/remove`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) orphansRetired.push(filename);
    } catch {
      // Retry next cycle.
    }
  }

  return NextResponse.json({
    ok: true,
    checked: rows?.length ?? 0,
    evicted,
    orphans_retired: orphansRetired,
    pending_swept: pendingSwept,
    probe: liveness.size > 0,
    threshold: DEAD_THRESHOLD,
  });
}
