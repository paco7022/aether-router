-- Discord server boosters get 10,000 permanent credits per calendar month.
-- Boosters are flagged via profiles.is_booster (set by an admin in the panel
-- or by the Discord bot through POST /api/v1/booster). A daily, idempotent
-- cron grants the monthly reward; grants stack month over month.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_booster boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booster_last_granted_at timestamptz;

-- Grant 10k credits to eligible boosters (no grant yet this calendar month).
-- p_user_id optional: when provided, only that user is considered — used to
-- reward a booster immediately when they're flagged, without waiting for cron.
-- Returns the number of users granted.
CREATE OR REPLACE FUNCTION public.grant_booster_credits(p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  granted int := 0;
  r record;
  newbal bigint;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles
    WHERE is_booster = true
      AND (p_user_id IS NULL OR id = p_user_id)
      AND (booster_last_granted_at IS NULL
           OR booster_last_granted_at < date_trunc('month', now()))
  LOOP
    UPDATE public.profiles
      SET credits = credits + 10000,
          booster_last_granted_at = now()
      WHERE id = r.id
      RETURNING credits INTO newbal;

    INSERT INTO public.transactions (user_id, amount, balance, type, description)
      VALUES (r.id, 10000, newbal, 'booster_grant', 'Monthly Discord booster reward');

    granted := granted + 1;
  END LOOP;

  RETURN granted;
END;
$$;

-- Only callers with elevated rights (service role / cron) may run it.
REVOKE EXECUTE ON FUNCTION public.grant_booster_credits(uuid) FROM public, anon, authenticated;

-- Daily at 00:07 UTC; the date_trunc('month') guard makes it grant at most
-- once per calendar month per booster, and rewards newly-flagged boosters the
-- next day instead of waiting for the 1st.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'grant-booster-credits') THEN
    PERFORM cron.unschedule('grant-booster-credits');
  END IF;
  PERFORM cron.schedule('grant-booster-credits', '7 0 * * *', 'SELECT public.grant_booster_credits();');
END $$;
