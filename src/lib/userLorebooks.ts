import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeLorebooks, MAX_LOREBOOK_BYTES, type Lorebook } from "./lorebook";

export type { LorebookRow } from "./lorebook";

/**
 * Server helpers for the lorebook library (user_lorebooks table).
 *
 * The request hot path never reads that table — it reads the merged copy in
 * profiles.lorebook. Every mutation that can change which entries are live
 * (activate, deactivate, save an active book, delete one) must re-mirror.
 */

export const MAX_USER_LOREBOOKS = 30;
export const MAX_ACTIVE_LOREBOOKS = 3;
export const MAX_LOREBOOK_NAME_LEN = 120;

export function sanitizeLorebookName(name: unknown): string {
  if (typeof name !== "string") return "My Lorebook";
  const trimmed = name.trim().slice(0, MAX_LOREBOOK_NAME_LEN);
  return trimmed || "My Lorebook";
}

/**
 * Rebuild profiles.lorebook from whatever the user has active right now.
 * With nothing active the column is cleared, so the pipeline skips the work
 * entirely instead of walking an empty book.
 */
export async function mirrorActiveLorebooks(
  admin: SupabaseClient,
  userId: string
): Promise<{ error: unknown; entryCount: number; oversized: boolean }> {
  const { data: rows, error: readErr } = await admin
    .from("user_lorebooks")
    .select("book")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: true });

  if (readErr) return { error: readErr, entryCount: 0, oversized: false };

  const books = ((rows ?? []) as Array<{ book: Lorebook }>)
    .map((r) => r.book)
    .filter((b): b is Lorebook => !!b && Array.isArray(b.entries))
    .slice(0, MAX_ACTIVE_LOREBOOKS);

  if (books.length === 0) {
    const { error } = await admin.from("profiles").update({ lorebook: null }).eq("id", userId);
    return { error, entryCount: 0, oversized: false };
  }

  const merged = mergeLorebooks(books);

  // profiles.lorebook is read on every single request, so an oversized merge
  // is refused rather than silently slowing the hot path down for everyone.
  const size = JSON.stringify(merged).length;
  if (size > MAX_LOREBOOK_BYTES) {
    return { error: null, entryCount: merged.entries.length, oversized: true };
  }

  const { error } = await admin.from("profiles").update({ lorebook: merged }).eq("id", userId);
  return { error, entryCount: merged.entries.length, oversized: false };
}

export async function countActiveLorebooks(
  admin: SupabaseClient,
  userId: string,
  excludeId?: string
): Promise<number> {
  let q = admin
    .from("user_lorebooks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);
  if (excludeId) q = q.neq("id", excludeId);
  const { count } = await q;
  return count ?? 0;
}
