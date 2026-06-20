-- Optional Discord account linking. Not mandatory; lets us deliver giveaways /
-- priority support and cross-reference abuse (e.g. CSAM) for Discord bans too.
-- Stored as the raw Discord snowflake ID (17-20 digit string).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discord_id text;

-- Non-unique: a Discord ID linked to multiple accounts is itself a useful
-- abuse signal, so we index for lookups rather than rejecting duplicates.
CREATE INDEX IF NOT EXISTS idx_profiles_discord_id
  ON public.profiles (discord_id)
  WHERE discord_id IS NOT NULL;
