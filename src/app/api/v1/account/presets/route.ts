import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { validatePreset, type UserPreset } from "@/lib/preset";
import {
  MAX_USER_PRESETS,
  sanitizePresetName,
  type UserPresetRow,
} from "@/lib/userPresets";

export const runtime = "nodejs";

// GET — list the user's preset library plus which one is active.
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const [{ data: rows }, { data: profile }] = await Promise.all([
    admin
      .from("user_presets")
      .select("id, name, preset, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    admin
      .from("profiles")
      .select("active_preset_id, preset_enabled, builtin_preset_id")
      .eq("id", user.id)
      .single(),
  ]);

  return NextResponse.json({
    presets: (rows ?? []) as UserPresetRow[],
    active_preset_id: profile?.active_preset_id ?? null,
    preset_enabled: profile?.preset_enabled ?? false,
    builtin_preset_id: profile?.builtin_preset_id ?? null,
  });
}

// POST — create a new library preset (new / save-as / duplicate).
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

  let body: { name?: string; preset?: UserPreset };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validatePreset(body.preset)) {
    return NextResponse.json(
      { error: "Invalid preset shape or exceeds 256KB limit" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { count } = await admin
    .from("user_presets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) >= MAX_USER_PRESETS) {
    return NextResponse.json(
      { error: `Preset library is full (max ${MAX_USER_PRESETS}). Delete one first.` },
      { status: 400 }
    );
  }

  const name = sanitizePresetName(body.name ?? body.preset.name);
  const { data, error } = await admin
    .from("user_presets")
    .insert({ user_id: user.id, name, preset: body.preset })
    .select("id, name, preset, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create preset" }, { status: 500 });
  }

  return NextResponse.json({ preset: data as UserPresetRow });
}
