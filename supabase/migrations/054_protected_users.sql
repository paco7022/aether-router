-- ============================================================
-- Protected users / whitelist (2026-04-22)
--
-- Adds is_protected to profiles. Protected users are skipped by the
-- anti-abuse device-fingerprint trigger — they can share a device or
-- IP with other accounts without tripping the multi-account auto-ban.
-- Reserved for: real paid subscribers, gifted plans (friends/VIP),
-- and admin-owned accounts.
--
-- Rationale: the anti-abuse triggers from migration 050 enforce a
-- "3+ accounts on same fingerprint = ban them all" rule. That works
-- for sockpuppet rings but false-positives on legit cases — e.g. a
-- family sharing a device, or a friend we gifted a plan who also
-- happens to log in from a coffee-shop IP we've seen before. The
-- whitelist gives us an escape hatch without weakening the rule for
-- everyone else.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_protected IS
  'True = skipped by enforce_device_bans. Reserved for real paid subs, gifted plans, and admins.';

CREATE INDEX IF NOT EXISTS idx_profiles_is_protected
  ON public.profiles (is_protected) WHERE is_protected = true;

-- -----------------------------------------------------
-- Rewrite enforce_device_bans to honour is_protected:
--   - Protected users bypass all anti-abuse checks.
--   - Protected users don't count toward the "3+ users on one
--     fingerprint" threshold and aren't included in the ban sweep
--     that threshold triggers.
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_device_bans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_banned     boolean;
  v_count      integer;
  v_protected  boolean;
BEGIN
  SELECT COALESCE(is_protected, false) INTO v_protected
  FROM public.profiles WHERE id = NEW.user_id;

  IF v_protected THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.banned_fingerprints
    WHERE (fingerprint IS NOT NULL AND fingerprint = NEW.fingerprint)
       OR (ip_address IS NOT NULL AND ip_address = NEW.ip_address)
  ) INTO v_banned;

  IF v_banned THEN
    UPDATE auth.users SET banned_until = 'infinity'::timestamptz
    WHERE id = NEW.user_id;
    RAISE EXCEPTION 'Device/IP is banned' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(DISTINCT df.user_id)
  FROM public.device_fingerprints df
  JOIN public.profiles p ON p.id = df.user_id
  WHERE df.fingerprint = NEW.fingerprint
    AND COALESCE(p.is_protected, false) = false
  INTO v_count;

  IF v_count >= 2 THEN
    INSERT INTO public.banned_fingerprints (fingerprint, ip_address, reason, banned_by)
    VALUES (NEW.fingerprint, NEW.ip_address, 'Auto: 3+ accounts on same fingerprint', 'auto_trigger')
    ON CONFLICT DO NOTHING;

    UPDATE auth.users SET banned_until = 'infinity'::timestamptz
    WHERE id IN (
      SELECT df.user_id
      FROM public.device_fingerprints df
      JOIN public.profiles p ON p.id = df.user_id
      WHERE df.fingerprint = NEW.fingerprint
        AND COALESCE(p.is_protected, false) = false
      UNION SELECT NEW.user_id
    );
    RAISE EXCEPTION 'Multi-account abuse detected on device' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
