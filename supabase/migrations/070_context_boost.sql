-- Per-user context limit boost (purchasable upgrade).
--
-- context_boost_expires_at controls whether a user's gm_max_context cap is
-- doubled at request time:
--   NULL       = no boost active
--   timestamp  = boost active until that time (1-hour option)
--   'infinity' = boost active indefinitely (plan-duration option)
--
-- Costs are enforced in the application layer (see /api/v1/boost/context).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS context_boost_expires_at TIMESTAMPTZ NULL DEFAULT NULL;

COMMENT ON COLUMN profiles.context_boost_expires_at IS
  'When set (including infinity), the user''s gm_max_context cap is doubled. NULL means no boost.';
