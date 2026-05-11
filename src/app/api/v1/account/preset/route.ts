import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { validatePreset, type UserPreset } from "@/lib/preset";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("preset, preset_enabled")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    preset: profile?.preset ?? null,
    preset_enabled: profile?.preset_enabled ?? false,
  });
}

export async function PATCH(req: NextRequest) {
  const csrfError = requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { preset?: UserPreset | null; preset_enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ("preset" in body) {
    if (body.preset === null) {
      updates.preset = null;
    } else if (!validatePreset(body.preset)) {
      return NextResponse.json({ error: "Invalid preset shape or exceeds 256KB limit" }, { status: 400 });
    } else {
      updates.preset = body.preset;
    }
  }

  if ("preset_enabled" in body) {
    if (typeof body.preset_enabled !== "boolean") {
      return NextResponse.json({ error: "preset_enabled must be a boolean" }, { status: 400 });
    }
    updates.preset_enabled = body.preset_enabled;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(updates).eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save preset" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
