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

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("kiro_pool_accounts")
    .select("id, filename")
    .eq("status", "active")
    .neq("filename", "pending");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const evicted: string[] = [];
  for (const row of rows ?? []) {
    const h = health.get(row.filename);
    let dead: string | null = null;
    if (!h) {
      dead = "missing_from_gateway";
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

  return NextResponse.json({
    ok: true,
    checked: rows?.length ?? 0,
    evicted,
    threshold: DEAD_THRESHOLD,
  });
}
