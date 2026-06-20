import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/v1/booster — Discord bot syncs server-booster status.
//
// Auth: Authorization: Bearer <DISCORD_BOT_SECRET>
// Body: { discord_id: string, boosting: boolean }
//
// Resolves the linked account by profiles.discord_id, flips is_booster, and
// (when boosting) immediately grants this month's 10k reward (idempotent per
// calendar month). Returns matched=0 if no account linked that Discord ID yet.
export async function POST(req: NextRequest) {
  const secret = process.env.DISCORD_BOT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Booster endpoint not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { discord_id?: unknown; boosting?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const discordId = typeof body.discord_id === "string" ? body.discord_id.trim() : "";
  const boosting = body.boosting === true || body.boosting === "true";
  if (!/^\d{17,20}$/.test(discordId)) {
    return NextResponse.json({ error: "Invalid discord_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("profiles")
    .update({ is_booster: boosting })
    .eq("discord_id", discordId)
    .select("id");

  if (error) {
    console.error("Booster sync failed:", error.message);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }

  const matched = rows?.length ?? 0;

  // Reward immediately on enable (RPC is idempotent per calendar month).
  let granted = 0;
  if (boosting && matched > 0) {
    for (const row of rows!) {
      const { data: g, error: grantErr } = await admin.rpc("grant_booster_credits", { p_user_id: row.id });
      if (grantErr) console.error("Booster grant failed:", grantErr.message);
      else granted += Number(g) || 0;
    }
  }

  return NextResponse.json({ ok: true, matched, boosting, granted });
}
