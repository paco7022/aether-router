import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";

// Kiro community pool — any logged-in user (free included) can contribute their
// own Kiro account by pasting their refresh token. The token is validated +
// captured by the gateway (which stores it on the VPS, never in our DB); here we
// only enforce the global slot cap, dedupe, and record metadata.

const MAX_SLOTS = Number(process.env.KIRO_POOL_MAX_SLOTS) || 3;

// The gateway admin API lives at the gateway base (KIRO_BASE_URL without /v1).
function gatewayAdminBase(): string | null {
  const explicit = process.env.KIRO_ADMIN_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = process.env.KIRO_BASE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function tokenHash(token: string): string {
  // Must match the gateway's hashing: sha256 hex, first 12 chars.
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

// Pull the refreshToken out of whatever the user pasted: a bare token, a
// { refresh_token } body, or the full kiro-auth-token.json blob.
function extractRefreshToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  if (typeof b.refresh_token === "string" && b.refresh_token.trim()) {
    return b.refresh_token.trim();
  }
  if (typeof b.refreshToken === "string" && b.refreshToken.trim()) {
    return b.refreshToken.trim();
  }
  if (typeof b.token_json === "string" && b.token_json.trim()) {
    try {
      const parsed = JSON.parse(b.token_json);
      if (parsed && typeof parsed.refreshToken === "string") {
        return parsed.refreshToken.trim();
      }
    } catch {
      // token_json wasn't JSON — maybe they pasted the bare token there.
      const raw = b.token_json.trim();
      if (raw && !/\s/.test(raw)) return raw;
    }
  }
  return null;
}

// GET — pool status for the UI: slots used/max and whether the caller already
// has a live contribution.
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("kiro_pool_accounts")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  const { count: mine } = await admin
    .from("kiro_pool_accounts")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("contributor_user_id", user.id);

  const used = count ?? 0;
  return NextResponse.json({
    used,
    max: MAX_SLOTS,
    slots_free: Math.max(0, MAX_SLOTS - used),
    mine: mine ?? 0,
  });
}

// POST — contribute a Kiro account to the pool.
export async function POST(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const refreshToken = extractRefreshToken(body);
  if (!refreshToken || refreshToken.length < 20) {
    return NextResponse.json(
      {
        error:
          "No encontré tu refresh token. Pega el contenido completo de tu kiro-auth-token.json o el refreshToken.",
      },
      { status: 400 }
    );
  }

  const adminBase = gatewayAdminBase();
  const secret = process.env.POOL_ADMIN_SECRET;
  if (!adminBase || !secret) {
    return NextResponse.json(
      { error: "El pool de Kiro no está configurado en el servidor." },
      { status: 503 }
    );
  }

  const hash = tokenHash(refreshToken);
  const admin = createAdminClient();

  // Atomically reserve a slot (enforces the global cap + dedupe).
  const { data: reservation, error: reserveErr } = await admin.rpc(
    "reserve_kiro_pool_slot",
    { p_token_hash: hash, p_user: user.id, p_max: MAX_SLOTS }
  );
  if (reserveErr) {
    console.error("reserve_kiro_pool_slot failed:", reserveErr.message);
    return NextResponse.json(
      { error: "No se pudo reservar un espacio. Intenta de nuevo." },
      { status: 500 }
    );
  }
  if (reservation === "duplicate") {
    return NextResponse.json(
      { error: "Esa cuenta ya está en el pool." },
      { status: 409 }
    );
  }
  if (reservation === "full") {
    return NextResponse.json(
      { error: "Ups, demasiadas cuentas ahora mismo. Intenta más tarde." },
      { status: 429 }
    );
  }

  // Slot reserved — hand the token to the gateway to validate + capture.
  try {
    const res = await fetch(`${adminBase}/admin/pool/add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      // Capture failed — release the reserved slot so it's not wasted.
      await admin.rpc("release_kiro_pool_slot", { p_token_hash: hash });
      if (res.status === 422) {
        return NextResponse.json(
          {
            error:
              "Tu token no es válido o ya expiró. Vuelve a copiarlo desde Kiro (recién logueado) e inténtalo otra vez.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "El pool no pudo validar tu cuenta. Intenta más tarde." },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { filename?: string };
    const filename = data.filename || `account_pool_${hash}.json`;
    await admin.rpc("finalize_kiro_pool_slot", {
      p_token_hash: hash,
      p_filename: filename,
    });

    return NextResponse.json({
      ok: true,
      message:
        "¡Cuenta añadida al pool! Recuerda hacer LOGOUT de Kiro Desktop o tu cuenta morirá en ~1h.",
    });
  } catch (e) {
    await admin.rpc("release_kiro_pool_slot", { p_token_hash: hash });
    console.error("kiro pool add error:", (e as Error).message);
    return NextResponse.json(
      { error: "No se pudo contactar el pool. Intenta más tarde." },
      { status: 502 }
    );
  }
}
