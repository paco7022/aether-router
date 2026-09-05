import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCsrf } from "@/lib/csrf";
import { validateLorebook, type Lorebook, type LorebookRow } from "@/lib/lorebook";
import {
  MAX_ACTIVE_LOREBOOKS,
  countActiveLorebooks,
  mirrorActiveLorebooks,
  sanitizeLorebookName,
} from "@/lib/userLorebooks";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// PATCH — rename / save content / activate / deactivate one lorebook.
// Anything that can change what the pipeline injects re-mirrors the merged
// blob into profiles.lorebook.
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

  let body: { name?: string; book?: Lorebook; is_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.book !== undefined && !validateLorebook(body.book)) {
    return NextResponse.json(
      { error: "Invalid lorebook shape or exceeds the 256KB limit" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("user_lorebooks")
    .select("id, is_active")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Lorebook not found" }, { status: 404 });
  }

  const wasActive = (existing as { is_active: boolean }).is_active;

  if (body.is_active === true && !wasActive) {
    const active = await countActiveLorebooks(admin, user.id, id);
    if (active >= MAX_ACTIVE_LOREBOOKS) {
      return NextResponse.json(
        {
          error: `You can have at most ${MAX_ACTIVE_LOREBOOKS} lorebooks active at once. Deactivate one first.`,
        },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") updates.name = sanitizeLorebookName(body.name);
  if (body.book !== undefined) {
    updates.book = body.book;
    updates.entry_count = body.book.entries.length;
  }
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;

  const { data: updated, error } = await admin
    .from("user_lorebooks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, book, is_active, updated_at")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Failed to update lorebook" }, { status: 500 });
  }

  const row = updated as LorebookRow;
  const liveNow = row.is_active || wasActive;
  let mirrored: Awaited<ReturnType<typeof mirrorActiveLorebooks>> | null = null;

  if (liveNow) {
    mirrored = await mirrorActiveLorebooks(admin, user.id);
    if (mirrored.oversized) {
      // Roll the activation back rather than leave the hot path pointing at a
      // blob it would have to drag through every request.
      await admin
        .from("user_lorebooks")
        .update({ is_active: wasActive })
        .eq("id", id)
        .eq("user_id", user.id);
      await mirrorActiveLorebooks(admin, user.id);
      return NextResponse.json(
        { error: "Those lorebooks are too large to activate together (256KB max combined)." },
        { status: 400 }
      );
    }
    if (mirrored.error) {
      return NextResponse.json({ error: "Failed to apply lorebook" }, { status: 500 });
    }
    // Activating something is only useful with the master switch on.
    if (row.is_active) {
      await admin.from("profiles").update({ lorebook_enabled: true }).eq("id", user.id);
    }
  }

  return NextResponse.json({
    lorebook: row,
    active_entries: mirrored?.entryCount ?? null,
  });
}

// DELETE — remove a lorebook, re-mirroring if it was live.
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

  const { data: existing } = await admin
    .from("user_lorebooks")
    .select("is_active")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  const { error } = await admin
    .from("user_lorebooks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete lorebook" }, { status: 500 });
  }

  if ((existing as { is_active?: boolean } | null)?.is_active) {
    await mirrorActiveLorebooks(admin, user.id);
  }

  return NextResponse.json({ ok: true });
}
