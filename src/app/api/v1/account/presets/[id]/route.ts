import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { validatePreset, type UserPreset } from "@/lib/preset";
import {
  mirrorActivePreset,
  sanitizePresetName,
  type UserPresetRow,
} from "@/lib/userPresets";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// PATCH — update a library preset (rename / save content) and optionally
// activate it. Saving the already-active row also refreshes the materialized
// copy in profiles.preset so the live request pipeline stays in sync.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: { name?: string; preset?: UserPreset; activate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if ("preset" in body && body.preset !== undefined && !validatePreset(body.preset)) {
    return NextResponse.json(
      { error: "Invalid preset shape or exceeds 256KB limit" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Ownership check (also gives us current active pointer for sync logic).
  const [{ data: existing }, { data: profile }] = await Promise.all([
    admin
      .from("user_presets")
      .select("id, name, preset")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    admin.from("profiles").select("active_preset_id").eq("id", user.id).single(),
  ]);

  if (!existing) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  const rowUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") rowUpdates.name = sanitizePresetName(body.name);
  if (body.preset !== undefined) rowUpdates.preset = body.preset;

  const { data: updated, error } = await admin
    .from("user_presets")
    .update(rowUpdates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, preset, updated_at")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Failed to update preset" }, { status: 500 });
  }

  // Mirror into profiles.preset when activating, or when saving the row that
  // is already the active one (so the applied preset reflects the edit).
  const row = updated as UserPresetRow;
  const wasActive = profile?.active_preset_id === id;
  if (body.activate === true || wasActive) {
    const { error: mirrorErr } = await mirrorActivePreset(
      admin,
      user.id,
      id,
      row.preset,
      body.activate === true
    );
    if (mirrorErr) {
      return NextResponse.json({ error: "Failed to apply preset" }, { status: 500 });
    }
  }

  return NextResponse.json({ preset: row, activated: body.activate === true || wasActive });
}

// DELETE — remove a library preset. If it was the active one, also clear the
// materialized copy so nothing keeps getting applied.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("active_preset_id")
    .eq("id", user.id)
    .single();

  const { error } = await admin
    .from("user_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }

  // FK ON DELETE SET NULL clears active_preset_id, but the inline copy must be
  // cleared by hand so the pipeline stops applying the deleted preset.
  if (profile?.active_preset_id === id) {
    await admin.from("profiles").update({ preset: null }).eq("id", user.id);
  }

  return NextResponse.json({ ok: true });
}
