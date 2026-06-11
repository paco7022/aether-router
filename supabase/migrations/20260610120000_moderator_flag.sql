-- Decouple the moderator role from plan_id.
--
-- Until now a "moderator" was anyone on plan_id='mod' (a gifted Pro-equivalent
-- plan). That meant a paying user (e.g. ultimate) could not be made a moderator
-- without downgrading their plan. This adds an explicit flag so the moderator
-- role can be granted independently of billing: a user is a moderator if their
-- plan is 'mod' OR is_moderator is true.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_moderator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_moderator IS
  'Grants the scoped moderation admin panel regardless of plan. Role is also granted by plan_id=''mod''. See lib/admin-role.ts getAdminRole().';
