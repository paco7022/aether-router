-- ============================================================
-- Lorebooks (SillyTavern World Info) — 2026-09-05
--
-- A lorebook is a list of keyword-triggered entries. Before each generation
-- the proxy scans the tail of the incoming chat and injects the entries that
-- fired, at the position each one asks for.
--
-- Design mirrors the preset library exactly (see 20260606000000):
--   * user_lorebooks is the library. The request hot path NEVER reads it.
--   * profiles.lorebook is the materialized blob of the user's ACTIVE books
--     merged into one, fetched by auth.ts in the same single query it
--     already does — zero extra roundtrips per request.
--   * profiles.lorebook_enabled is the master switch, independent of
--     preset_enabled: lorebooks work with or without an active preset.
--
-- Several books can be active at once (the app caps it at 3); activation is
-- tracked per row instead of with a pointer column, and any change re-mirrors
-- the merged blob.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_lorebooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'My Lorebook',
  book        JSONB NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The library as the settings page lists it: most recently updated first.
CREATE INDEX IF NOT EXISTS idx_user_lorebooks_user
  ON public.user_lorebooks (user_id, updated_at DESC);

-- Re-mirroring reads only the active rows of one user.
CREATE INDEX IF NOT EXISTS idx_user_lorebooks_active
  ON public.user_lorebooks (user_id) WHERE is_active;

ALTER TABLE public.user_lorebooks ENABLE ROW LEVEL SECURITY;

-- Same posture as user_presets: service-role only, scoped by user_id in the
-- app layer, no direct client access.
REVOKE ALL ON TABLE public.user_lorebooks FROM anon, authenticated;
GRANT  ALL ON TABLE public.user_lorebooks TO service_role;

COMMENT ON TABLE public.user_lorebooks IS
  'Per-user lorebook library (SillyTavern World Info). Active rows are merged into profiles.lorebook for the request hot path; this table is only touched by the dashboard settings UI.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lorebook JSONB;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lorebook_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.lorebook IS
  'Materialized merge of the user active user_lorebooks rows, applied by the chat pipeline. NULL = nothing to inject.';

COMMENT ON COLUMN public.profiles.lorebook_enabled IS
  'Master switch for lorebook injection. Independent of preset_enabled.';
