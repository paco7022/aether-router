-- ============================================================
-- Referral system
-- Each "real" invite (different device fingerprint AND different IP
-- from the referrer) grants +10 premium requests/day for 3 days to
-- BOTH referrer and referee. Bonuses stack while the window is open.
-- ============================================================

-- 1. Profile columns -----------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referral_bonus_requests INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_bonus_expires  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);

-- 2. Referral code generator --------------------------------------------
-- 6 chars from an unambiguous alphabet (no 0/O/1/I).
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code TEXT;
  i INT;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill codes for existing users ----------------------------------
UPDATE public.profiles
SET    referral_code = public.generate_referral_code()
WHERE  referral_code IS NULL;

-- 4. Update signup trigger to assign a code on creation -----------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  plan_daily BIGINT;
BEGIN
  SELECT credits_per_day INTO plan_daily FROM public.plans WHERE id = 'free';

  INSERT INTO public.profiles (id, email, display_name, plan_id, daily_credits, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'free',
    COALESCE(plan_daily, 0),
    public.generate_referral_code()
  );

  INSERT INTO public.subscriptions (user_id, plan_id, status, last_grant_date)
  VALUES (NEW.id, 'free', 'active', CURRENT_DATE);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Referrals table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referrals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referee_id          UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referee_fingerprint TEXT,
  referee_ip          TEXT,
  status              TEXT NOT NULL DEFAULT 'valid',  -- valid | rejected
  reject_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own referrals" ON public.referrals;
CREATE POLICY "Users can view their own referrals" ON public.referrals
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

-- Lock down writes — all mutations go through the redeem_referral RPC.
REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM anon, authenticated;

-- 6. Redeem RPC ---------------------------------------------------------
-- Validates that referee is a real human (not same device / not same IP
-- as the referrer) and grants +10 requests / 3-day window to both parties.
CREATE OR REPLACE FUNCTION public.redeem_referral(
  p_referee_id  UUID,
  p_code        TEXT,
  p_fingerprint TEXT,
  p_ip          TEXT
) RETURNS JSONB AS $$
DECLARE
  v_referrer_id UUID;
  v_bonus       CONSTANT INTEGER := 10;
  v_days        CONSTANT INTEGER := 3;
  v_new_expires TIMESTAMPTZ;
  v_code        TEXT;
BEGIN
  IF p_referee_id IS NULL OR p_code IS NULL OR length(p_code) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing params');
  END IF;

  v_code := upper(trim(p_code));

  -- Find referrer by code
  SELECT id INTO v_referrer_id
  FROM public.profiles
  WHERE referral_code = v_code;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  IF v_referrer_id = p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  -- Referee can only be referred once
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = p_referee_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already referred');
  END IF;

  -- Same-device check
  IF p_fingerprint IS NOT NULL AND length(p_fingerprint) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE user_id = v_referrer_id AND fingerprint = p_fingerprint
    ) THEN
      INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status, reject_reason)
      VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'rejected', 'fingerprint_match');
      RETURN jsonb_build_object('success', false, 'error', 'Same device as referrer');
    END IF;
  END IF;

  -- Same-IP check
  IF p_ip IS NOT NULL AND p_ip <> '' AND p_ip <> 'unknown' THEN
    IF EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE user_id = v_referrer_id AND ip_address = p_ip
    ) THEN
      INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status, reject_reason)
      VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'rejected', 'ip_match');
      RETURN jsonb_build_object('success', false, 'error', 'Same IP as referrer');
    END IF;
  END IF;

  -- Record the valid referral
  INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status)
  VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'valid');

  v_new_expires := now() + (v_days || ' days')::interval;

  -- Grant / stack bonus for referrer
  UPDATE public.profiles SET
    referral_bonus_requests = CASE
      WHEN referral_bonus_expires IS NOT NULL AND referral_bonus_expires > now()
        THEN referral_bonus_requests + v_bonus
      ELSE v_bonus
    END,
    referral_bonus_expires = v_new_expires,
    updated_at = now()
  WHERE id = v_referrer_id;

  -- Grant / stack bonus for referee
  UPDATE public.profiles SET
    referral_bonus_requests = CASE
      WHEN referral_bonus_expires IS NOT NULL AND referral_bonus_expires > now()
        THEN referral_bonus_requests + v_bonus
      ELSE v_bonus
    END,
    referral_bonus_expires = v_new_expires,
    updated_at = now()
  WHERE id = p_referee_id;

  RETURN jsonb_build_object(
    'success', true,
    'bonus_requests', v_bonus,
    'expires_at', v_new_expires
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.redeem_referral(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.redeem_referral(UUID, TEXT, TEXT, TEXT) TO service_role;
