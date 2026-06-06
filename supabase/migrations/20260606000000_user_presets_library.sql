-- ============================================================
-- User preset library — multiple named presets per user (2026-06-06)
--
-- Until now each user had exactly ONE preset, stored inline in
-- profiles.preset (JSONB) and toggled by profiles.preset_enabled. This
-- migration adds a SillyTavern-style library: a user can save many named
-- presets and switch the active one.
--
-- Design — zero impact on the request hot path:
--   * profiles.preset stays the AUTHORITATIVE materialized copy that
--     auth.ts already fetches in a single query and the chat pipeline
--     applies. Nothing in the proxy path reads the new table.
--   * user_presets is the library (the dropdown). Only the dashboard
--     settings UI / account API touch it.
--   * profiles.active_preset_id points at the library row currently
--     mirrored into profiles.preset (UI hint + keep-in-sync target).
--
-- Activating a library row copies it into profiles.preset; saving the
-- active row refreshes that copy. Built-in Aether presets
-- (profiles.builtin_preset_id) keep precedence exactly as before.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_presets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'My Preset',
  preset     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user's library, most-recently-updated first when the settings page loads.
CREATE INDEX IF NOT EXISTS idx_user_presets_user
  ON public.user_presets (user_id, updated_at DESC);

ALTER TABLE public.user_presets ENABLE ROW LEVEL SECURITY;

-- All access is via the service-role admin client, scoped by user_id in the
-- app layer (same pattern as the rest of the account API). Lock out direct
-- client access so the library can't be read/written bypassing the API.
REVOKE ALL ON TABLE public.user_presets FROM anon, authenticated;
GRANT  ALL ON TABLE public.user_presets TO service_role;

COMMENT ON TABLE public.user_presets IS
  'Per-user preset library (named SillyTavern-style presets). The active one is mirrored into profiles.preset for the request hot path; this table is only touched by the dashboard settings UI.';

-- Pointer to the library row currently mirrored into profiles.preset.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_preset_id UUID
    REFERENCES public.user_presets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.active_preset_id IS
  'Library row (user_presets.id) currently mirrored into profiles.preset. NULL = no saved library preset selected. UI hint + keep-in-sync target; the request pipeline still reads profiles.preset.';

-- ------------------------------------------------------------
-- Backfill: seed the library from each user's existing inline preset so
-- nobody loses their current config, and point active_preset_id at it.
-- ------------------------------------------------------------
WITH seeded AS (
  INSERT INTO public.user_presets (user_id, name, preset, created_at, updated_at)
  SELECT
    p.id,
    COALESCE(NULLIF(p.preset->>'name', ''), 'My Preset'),
    p.preset,
    now(),
    now()
  FROM public.profiles p
  WHERE p.preset IS NOT NULL
    AND p.active_preset_id IS NULL
  RETURNING id, user_id
)
UPDATE public.profiles p
SET active_preset_id = s.id
FROM seeded s
WHERE p.id = s.user_id;
