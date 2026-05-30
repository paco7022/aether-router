-- ============================================================
-- 20260530000000_fix_referral_ip_selfmatch
--
-- BUG: referrals stopped recording entirely on 2026-05-17.
--
-- Migration 044 added a self-consistency gate to redeem_referral that
-- required the SERVER-OBSERVED IP of the redeem request to exactly match
-- one of the referee's already-stored device_fingerprints rows, returning
-- an error WITHOUT inserting any referral row on mismatch.
--
-- This held while traffic was stable IPv4 (Apr 22 – May 17). After the
-- Cloudflare/PC hybrid rollout and the IPv6-mobile ramp, the IP observed
-- at /api/v1/referral/redeem stopped matching the IP observed moments
-- earlier at /api/v1/fingerprint:
--   * IPv6 mobile rotates the source address per connection.
--   * IPv4 behind CGNAT / multi-egress proxies changes the last octet
--     between two sequential requests (observed in prod: .69<->.83,
--     .209<->.210, .131<->.132).
-- Result: every legitimate referral hit "IP mismatch" and was silently
-- dropped (the register page swallows the error). Zero referral rows of
-- ANY status since 2026-05-17 despite 5-12 signups/day.
--
-- FIX: drop ONLY the IP self-match check. We keep:
--   * v_has_device     (referee must have passed the dashboard fingerprint
--                        POST flow — cheap, reliable proof of presence)
--   * v_fp_matches     (the body fingerprint must be one the server stored;
--                        the same getFingerprint() value is sent to both
--                        endpoints, so this is stable and not affected by
--                        the IP rotation regression)
--   * cross-account fingerprint + IP dedupe (records a rejected row)
--   * enforce_referral_limits trigger (same-device-as-referrer + caps)
--
-- The IP is still recorded on the referral row and still used for the
-- cross-account dedupe below; we just no longer demand that the referee's
-- own redeem-time IP equal their own signup-time IP.
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
  v_clean_fp    TEXT;
  v_has_device  BOOLEAN;
  v_fp_matches  BOOLEAN;
BEGIN
  IF p_referee_id IS NULL OR p_code IS NULL OR length(p_code) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing params');
  END IF;

  v_code := upper(trim(p_code));
  v_clean_fp := lower(trim(coalesce(p_fingerprint, '')));

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

  -- The referee MUST have at least one server-observed device record.
  SELECT EXISTS (
    SELECT 1 FROM public.device_fingerprints WHERE user_id = p_referee_id
  ) INTO v_has_device;

  IF NOT v_has_device THEN
    RETURN jsonb_build_object('success', false, 'error', 'Device proof required');
  END IF;

  -- The body-supplied fingerprint must match one of the referee's recorded
  -- devices. (Stable across requests; unaffected by the IP regression.)
  IF v_clean_fp <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE user_id = p_referee_id
        AND lower(fingerprint) = v_clean_fp
    ) INTO v_fp_matches;
    IF NOT v_fp_matches THEN
      RETURN jsonb_build_object('success', false, 'error', 'Fingerprint mismatch');
    END IF;
  END IF;

  -- NOTE: the former IP self-match check was removed here. Requiring the
  -- redeem-time IP to equal the referee's signup-time IP produced mass
  -- false negatives on rotating IPv6 / CGNAT egress (see migration header).

  -- Cross-account dedupe: this fingerprint must not belong to anyone else.
  IF v_clean_fp <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE lower(fingerprint) = v_clean_fp
        AND user_id <> p_referee_id
    ) THEN
      INSERT INTO public.referrals (referrer_id, referee_id, referee_fingerprint, referee_ip, status, reject_reason)
      VALUES (v_referrer_id, p_referee_id, p_fingerprint, p_ip, 'rejected', 'fingerprint_match');
      RETURN jsonb_build_object('success', false, 'error', 'Device already registered');
    END IF;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.redeem_referral(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.redeem_referral(UUID, TEXT, TEXT, TEXT) TO service_role;
