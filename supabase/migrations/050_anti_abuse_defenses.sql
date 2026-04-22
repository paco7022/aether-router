-- ============================================================
-- Anti-abuse defenses (2026-04-22)
--
-- Supabase sent a rate-limit warning triggered by a referral-farming
-- spike: one user accumulated 24 referrals in 18h, plus a sockpuppet
-- ring on a single IP and a batch of disposable-email signups.
--
-- This migration installs DB-level guards independent of app code so
-- future abuse is blocked at insert time:
--   1) blocked_email_domains + trigger on auth.users to reject
--      disposable email domains and gmail "+" aliases at signup.
--   2) Trigger on device_fingerprints that rejects inserts when the
--      fingerprint or IP is already in banned_fingerprints, and
--      auto-bans any fingerprint that reaches 3+ distinct users.
--   3) Trigger on referrals that rejects self-referrals (same
--      fingerprint/IP as referrer) and enforces 5/24h + 20 lifetime
--      caps per referrer.
-- ============================================================

-- -----------------------------------------------------
-- 1) Maintainable list of disposable email domains
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_email_domains (
  domain text PRIMARY KEY,
  reason text,
  created_at timestamptz DEFAULT NOW()
);

INSERT INTO public.blocked_email_domains (domain, reason) VALUES
  ('mailfence.com','disposable'),
  ('sharebot.net','disposable'),
  ('comfythings.com','disposable'),
  ('poisonword.com','disposable'),
  ('buyvps.us','disposable'),
  ('sskaid.com','disposable'),
  ('atomicmail.io','disposable'),
  ('marvetos.com','disposable'),
  ('tempmail.com','disposable'),
  ('temp-mail.org','disposable'),
  ('guerrillamail.com','disposable'),
  ('10minutemail.com','disposable'),
  ('mailinator.com','disposable'),
  ('throwawaymail.com','disposable'),
  ('yopmail.com','disposable'),
  ('getnada.com','disposable'),
  ('trashmail.com','disposable'),
  ('dispostable.com','disposable'),
  ('maildrop.cc','disposable'),
  ('fakemail.net','disposable'),
  ('mintemail.com','disposable'),
  ('sharklasers.com','disposable'),
  ('emailondeck.com','disposable'),
  ('mohmal.com','disposable'),
  ('fakeinbox.com','disposable'),
  ('spamgourmet.com','disposable'),
  ('mytemp.email','disposable'),
  ('trashinbox.com','disposable'),
  ('inboxkitten.com','disposable'),
  ('tempail.com','disposable')
ON CONFLICT (domain) DO NOTHING;

-- -----------------------------------------------------
-- 2) Signup-time email validation
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_abusive_signups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_domain text;
  v_local  text;
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  v_domain := lower(split_part(NEW.email, '@', 2));
  v_local  := lower(split_part(NEW.email, '@', 1));

  IF EXISTS (SELECT 1 FROM public.blocked_email_domains WHERE domain = v_domain) THEN
    RAISE EXCEPTION 'Email domain not allowed' USING ERRCODE = '23514';
  END IF;

  IF v_domain = 'gmail.com' AND position('+' IN v_local) > 0 THEN
    RAISE EXCEPTION 'Gmail aliases are not allowed' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_abusive_signups_trigger ON auth.users;
CREATE TRIGGER block_abusive_signups_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.block_abusive_signups();

-- -----------------------------------------------------
-- 3) Device fingerprint guard
--    - Reject insert if fingerprint or IP is banned
--    - Auto-ban when a fingerprint reaches 3+ distinct users
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_device_bans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_banned  boolean;
  v_count   integer;
BEGIN
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

  SELECT COUNT(DISTINCT user_id)
  FROM public.device_fingerprints
  WHERE fingerprint = NEW.fingerprint
  INTO v_count;

  IF v_count >= 2 THEN
    INSERT INTO public.banned_fingerprints (fingerprint, ip_address, reason, banned_by)
    VALUES (NEW.fingerprint, NEW.ip_address, 'Auto: 3+ accounts on same fingerprint', 'auto_trigger')
    ON CONFLICT DO NOTHING;

    UPDATE auth.users SET banned_until = 'infinity'::timestamptz
    WHERE id IN (
      SELECT user_id FROM public.device_fingerprints WHERE fingerprint = NEW.fingerprint
      UNION SELECT NEW.user_id
    );
    RAISE EXCEPTION 'Multi-account abuse detected on device' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_device_bans_trigger ON public.device_fingerprints;
CREATE TRIGGER enforce_device_bans_trigger
  BEFORE INSERT ON public.device_fingerprints
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_device_bans();

-- -----------------------------------------------------
-- 4) Referral rate-limit + anti self-referral
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_referral_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recent    integer;
  v_total     integer;
  v_same_fp   boolean;
  v_same_ip   boolean;
BEGIN
  IF NEW.status IS NULL OR NEW.status <> 'valid' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.device_fingerprints df
    WHERE df.user_id = NEW.referrer_id
      AND df.fingerprint = NEW.referee_fingerprint
  ) INTO v_same_fp;

  SELECT EXISTS (
    SELECT 1 FROM public.device_fingerprints df
    WHERE df.user_id = NEW.referrer_id
      AND df.ip_address = NEW.referee_ip
  ) INTO v_same_ip;

  IF v_same_fp OR v_same_ip THEN
    NEW.status := 'rejected';
    NEW.reject_reason := COALESCE(NEW.reject_reason,'') ||
                         CASE WHEN v_same_fp THEN ' [same_fingerprint_as_referrer]' ELSE '' END ||
                         CASE WHEN v_same_ip THEN ' [same_ip_as_referrer]' ELSE '' END;
    RETURN NEW;
  END IF;

  SELECT COUNT(*) FROM public.referrals
  WHERE referrer_id = NEW.referrer_id
    AND status = 'valid'
    AND created_at > NOW() - INTERVAL '24 hours'
  INTO v_recent;

  IF v_recent >= 5 THEN
    NEW.status := 'rejected';
    NEW.reject_reason := COALESCE(NEW.reject_reason,'') || ' [rate_limit_24h_exceeded]';
    RETURN NEW;
  END IF;

  SELECT COUNT(*) FROM public.referrals
  WHERE referrer_id = NEW.referrer_id
    AND status = 'valid'
  INTO v_total;

  IF v_total >= 20 THEN
    NEW.status := 'rejected';
    NEW.reject_reason := COALESCE(NEW.reject_reason,'') || ' [lifetime_limit_20_exceeded]';
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_referral_limits_trigger ON public.referrals;
CREATE TRIGGER enforce_referral_limits_trigger
  BEFORE INSERT ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_referral_limits();
