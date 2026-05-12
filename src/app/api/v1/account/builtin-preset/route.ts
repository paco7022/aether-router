import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { isValidBuiltinPresetId, listPublicBuiltinPresets } from "@/lib/builtinPresets";

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
    .select("builtin_preset_id")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    available: listPublicBuiltinPresets(),
    active: (profile as { builtin_preset_id?: string | null } | null)?.builtin_preset_id ?? null,
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

  let body: { builtin_preset_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!("builtin_preset_id" in body)) {
    return NextResponse.json({ error: "Missing builtin_preset_id" }, { status: 400 });
  }

  const id = body.builtin_preset_id;
  if (id !== null && (typeof id !== "string" || !isValidBuiltinPresetId(id))) {
    return NextResponse.json({ error: "Unknown built-in preset id" }, { status: 400 });
  }

  // Setting a built-in implicitly enables the preset feature so the request
  // pipeline actually applies it. Clearing it leaves preset_enabled alone —
  // the user's custom preset (if any) keeps whatever state it had.
  const updates: Record<string, unknown> = { builtin_preset_id: id };
  if (id !== null) updates.preset_enabled = true;

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(updates).eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to save built-in preset selection" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
