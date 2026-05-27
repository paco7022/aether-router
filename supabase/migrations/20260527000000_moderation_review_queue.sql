-- ============================================================
-- Moderation review queue (2026-05-27)
--
-- Replaces the previous behaviour where a `sexual/minors` moderation flag
-- IMMEDIATELY and permanently banned the account + disabled every API key,
-- with no human in the loop. The omni-moderation boolean fires at a low
-- threshold, so legitimate adult roleplay was tripping it and nuking paying
-- accounts (false positives).
--
-- New behaviour: a flag NO LONGER bans or blocks. The request is routed
-- normally and a row is queued here for manual admin review. An admin then
-- either dismisses it (false positive) or actions a ban.
--
-- Unlike csam_incidents (hash-only), this table DOES store the flagged text
-- and the surrounding conversation context — a human cannot judge a
-- borderline case from a hash alone. Access is locked to the service role /
-- admins only, exactly like csam_incidents.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.moderation_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_hash    TEXT NOT NULL,
  -- The specific flagged fragment(s). Stored so a reviewer sees exactly what
  -- tripped the moderator.
  flagged_text    TEXT NOT NULL DEFAULT '',
  -- The surrounding user/system/assistant messages, so the reviewer has the
  -- full context the moderator saw. Bounded in the app layer.
  context         JSONB NOT NULL DEFAULT '[]'::jsonb,
  categories      TEXT[] NOT NULL DEFAULT '{}',
  category_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  source          TEXT NOT NULL CHECK (source IN ('api', 'chat')),
  -- pending  → awaiting review
  -- dismissed → reviewer confirmed false positive
  -- actioned  → reviewer confirmed violation and banned the account
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'dismissed', 'actioned')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest pending items first when an admin opens the queue.
CREATE INDEX IF NOT EXISTS idx_moderation_reviews_status
  ON public.moderation_reviews (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_reviews_user
  ON public.moderation_reviews (user_id, created_at DESC);

-- One pending row per (user, exact content). A chatty user resending the same
-- flagged text shouldn't flood the queue; growing context naturally produces a
-- new hash so genuinely new turns still get queued.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_moderation_reviews_user_hash
  ON public.moderation_reviews (user_id, content_hash);

ALTER TABLE public.moderation_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.moderation_reviews FROM anon, authenticated;
GRANT  ALL ON TABLE public.moderation_reviews TO service_role;

COMMENT ON TABLE public.moderation_reviews IS
  'Manual-review queue for moderation flags. Stores flagged text + context (admin-only). No auto-ban — a human actions or dismisses each row.';
