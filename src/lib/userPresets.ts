import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserPreset } from "./preset";

export type { UserPresetRow } from "./preset";

/**
 * Shared server helpers for the user preset library (user_presets table).
 *
 * The request hot path never reads this table — it reads the materialized
 * copy in profiles.preset. These helpers keep that copy in sync when the
 * active library row changes, and enforce the per-user library cap.
 */

export const MAX_USER_PRESETS = 50;
export const MAX_PRESET_NAME_LEN = 120;

export function sanitizePresetName(name: unknown): string {
  if (typeof name !== "string") return "My Preset";
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LEN);
  return trimmed || "My Preset";
}

/**
 * Mirror a library row into profiles so the proxy pipeline applies it.
 * Used both on explicit activate and when the already-active row is saved.
 *
 * On a fresh activate (`makeActive`), it also flips the master toggle on and
 * clears any built-in selection so the custom preset actually takes effect
 * (built-ins otherwise win in the chat pipeline).
 */
export async function mirrorActivePreset(
  admin: SupabaseClient,
  userId: string,
  presetId: string,
  preset: UserPreset,
  makeActive: boolean
): Promise<{ error: unknown }> {
  const updates: Record<string, unknown> = { preset };
  if (makeActive) {
    updates.active_preset_id = presetId;
    updates.preset_enabled = true;
    updates.builtin_preset_id = null;
  }
  const { error } = await admin.from("profiles").update(updates).eq("id", userId);
  return { error };
}
