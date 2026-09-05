import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { validateLorebook, type Lorebook, type LorebookRow } from "@/lib/lorebook";
import {
  MAX_USER_LOREBOOKS,
  sanitizeLorebookName,
} from "@/lib/userLorebooks";

export const runtime = "nodejs";

// GET — the user's lorebook library plus the master switch.
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
      .from("user_lorebooks")
      .select("id, name, book, is_active, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    admin.from("profiles").select("lorebook_enabled").eq("id", user.id).single(),
  ]);

  return NextResponse.json({
    lorebooks: (rows ?? []) as LorebookRow[],
    lorebook_enabled: profile?.lorebook_enabled ?? false,
  });
}

// POST — create a library lorebook (new / import / duplicate).
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

  let body: { name?: string; book?: Lorebook };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validateLorebook(body.book)) {
    return NextResponse.json(
      { error: "Invalid lorebook shape or exceeds the 256KB limit" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { count } = await admin
    .from("user_lorebooks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) >= MAX_USER_LOREBOOKS) {
    return NextResponse.json(
      { error: `Lorebook library is full (max ${MAX_USER_LOREBOOKS}). Delete one first.` },
      { status: 400 }
    );
  }

  const name = sanitizeLorebookName(body.name ?? body.book.name);
  const { data, error } = await admin
    .from("user_lorebooks")
    .insert({
      user_id: user.id,
      name,
      book: body.book,
      entry_count: body.book.entries.length,
      is_active: false,
    })
    .select("id, name, book, is_active, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create lorebook" }, { status: 500 });
  }

  return NextResponse.json({ lorebook: data as LorebookRow });
}

// PATCH — master switch only (per-book changes live under /[id]).
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

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ lorebook_enabled: body.enabled })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }

  return NextResponse.json({ lorebook_enabled: body.enabled });
}
