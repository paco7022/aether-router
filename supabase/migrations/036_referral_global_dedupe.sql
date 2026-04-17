-- ============================================================
-- Referral anti-abuse hardening
-- Only count invites from brand-new humans: reject if the referee's
-- fingerprint OR IP already belongs to any other registered user
-- (not just the referrer).
-- ============================================================

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

  SELECT id INTO v_referrer_id
  FROM public.profiles
  WHERE referral_code = v_code;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid referral code');
  END IF;

  IF v_referrer_id = p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot refer yourself');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = p_referee_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already referred');
  END IF;

  -- Reject if this device fingerprint is already tied to ANY other user.
  IF p_fingerprint IS NOT NULL AND length(p_fingerprint) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE fingerprint = p_fingerprint
        AND user_id <> p_referee_id
    ) THEN
      INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status, reject_reason)
      VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'rejected', 'fingerprint_match');
      RETURN jsonb_build_object('success', false, 'error', 'Device already registered');
    END IF;
  END IF;

  -- Reject if this IP is already tied to ANY other user.
  IF p_ip IS NOT NULL AND p_ip <> '' AND p_ip <> 'unknown' THEN
    IF EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE ip_address = p_ip
        AND user_id <> p_referee_id
    ) THEN
      INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status, reject_reason)
      VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'rejected', 'ip_match');
      RETURN jsonb_build_object('success', false, 'error', 'IP already registered');
    END IF;
  END IF;

  INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status)
  VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'valid');

  v_new_expires := now() + (v_days || ' days')::interval;

  UPDATE public.profiles SET
    referral_bonus_requests = CASE
      WHEN referral_bonus_expires IS NOT NULL AND referral_bonus_expires > now()
        THEN referral_bonus_requests + v_bonus
      ELSE v_bonus
    END,
    referral_bonus_expires = v_new_expires,
    updated_at = now()
  WHERE id = v_referrer_id;

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
