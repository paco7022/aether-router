-- ============================================================
-- CSAM moderation audit log (2026-04-28)
--
-- Persistent record of every input flagged by the OpenAI Moderations API
-- for the `sexual/minors` category. Used to:
--   - prove repeat detection across cold starts (the in-memory cache only
--     survives within a warm Vercel container)
--   - hand over evidence to law enforcement on a court order
--   - let admins audit / unban suspected false-positives
--
-- IMPORTANT: we never store the offending text. Only the SHA-256 hash, the
-- categories that fired, and the calibrated scores. The hash is enough to
-- correlate repeat attempts and to confirm a sample if the original message
-- can be produced by an investigator from another source.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.csam_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_hash    TEXT NOT NULL,
  categories      TEXT[] NOT NULL DEFAULT '{}',
  category_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  source          TEXT NOT NULL CHECK (source IN ('api', 'chat')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csam_incidents_user
  ON public.csam_incidents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_csam_incidents_hash
  ON public.csam_incidents (content_hash);

-- Lock down: only the service role inserts (from the API route after a
-- moderation hit) and only admins read. Regular authenticated users must
-- never see anything in this table — it's an admin/legal record.
ALTER TABLE public.csam_incidents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.csam_incidents FROM anon, authenticated;
GRANT  ALL ON TABLE public.csam_incidents TO service_role;

COMMENT ON TABLE public.csam_incidents IS
  'Audit log of OpenAI Moderations sexual/minors hits. Hashes only — never raw text.';
