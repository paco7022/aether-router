-- ============================================================
-- 044_security_hardening_april_2026
--
-- Fixes uncovered by the April 2026 red-team audit:
--
-- 1. `grant_paid_referral_bonus` re-fired on every paid checkout, so a user
--    could cancel + resubscribe (or upgrade) repeatedly to stack +15
--    premium-requests/day on themselves and their referrer indefinitely.
--    We now grant the paid bonus at most once per (referrer, referee) pair.
--
-- 2. `redeem_referral` requires the SERVER-OBSERVED fingerprint and IP of
--    the REFEREE. Previously the body-supplied fingerprint was the only
--    cross-account dedupe hint; an attacker could simply send a random
--    string per Sybil signup and bypass dedupe entirely. By requiring at
--    least one row in `device_fingerprints` for the referee BEFORE
--    redeeming, we ensure they passed through the in-dashboard
--    fingerprint POST flow first. We also reject when the fingerprint or
--    IP submitted does not match any of the referee's recorded devices.
--
-- 3. Atomic free-event reservation RPC. Previously the per-user message
--    cap and rate limit were enforced via SELECT-then-act on `usage_logs`,
--    which logs are only inserted on stream flush — a TOCTOU window
--    long enough (entire upstream call) to drive multiple parallel
--    requests past the limit.
-- ============================================================

-- ── 1. Paid referral bonus: grant once per pair --------------
CREATE OR REPLACE FUNCTION public.grant_paid_referral_bonus(
  p_referee_id UUID,
  p_bonus      INTEGER DEFAULT 15,
  p_days       INTEGER DEFAULT 7
) RETURNS JSONB AS $$
DECLARE
  v_referral_id UUID;
  v_referrer_id UUID;
  v_already_granted TIMESTAMPTZ;
  v_new_expires TIMESTAMPTZ;
BEGIN
  IF p_referee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing referee');
  END IF;

  SELECT id, referrer_id, paid_bonus_granted_at
    INTO v_referral_id, v_referrer_id, v_already_granted
  FROM public.referrals
  WHERE referee_id = p_referee_id
    AND status = 'valid'
  LIMIT 1;

  IF v_referral_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No valid referral');
  END IF;

  IF v_already_granted IS NOT NULL THEN
    -- Already granted once. Do NOT stack on resubscribe / upgrade /
    -- portal session re-issue.
    RETURN jsonb_build_object('success', false, 'error', 'Already granted');
  END IF;

  v_new_expires := now() + (p_days || ' days')::interval;

  UPDATE public.profiles SET
    referral_bonus_requests = CASE
      WHEN referral_bonus_expires IS NOT NULL AND referral_bonus_expires > now()
        THEN referral_bonus_requests + p_bonus
      ELSE p_bonus
    END,
    referral_bonus_expires = v_new_expires,
    updated_at = now()
  WHERE id = v_referrer_id;

  UPDATE public.profiles SET
    referral_bonus_requests = CASE
      WHEN referral_bonus_expires IS NOT NULL AND referral_bonus_expires > now()
        THEN referral_bonus_requests + p_bonus
      ELSE p_bonus
    END,
    referral_bonus_expires = v_new_expires,
    updated_at = now()
  WHERE id = p_referee_id;

  UPDATE public.referrals
     SET paid_bonus_granted_at = now()
   WHERE id = v_referral_id;

  RETURN jsonb_build_object(
    'success',        true,
    'bonus_requests', p_bonus,
    'days',           p_days,
    'expires_at',     v_new_expires,
    'referrer_id',    v_referrer_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.grant_paid_referral_bonus(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_paid_referral_bonus(UUID, INTEGER, INTEGER) TO service_role;


-- ── 2. Referral redemption: require server-observed device proof ----
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
  v_ip_matches  BOOLEAN;
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
  -- Without this gate, attackers could send a random new fingerprint per
  -- Sybil account body-payload and never trigger any global dedupe hit.
  SELECT EXISTS (
    SELECT 1 FROM public.device_fingerprints WHERE user_id = p_referee_id
  ) INTO v_has_device;

  IF NOT v_has_device THEN
    RETURN jsonb_build_object('success', false, 'error', 'Device proof required');
  END IF;

  -- The body-supplied fingerprint and IP must match one of the referee's
  -- recorded devices. This prevents the attacker from quoting a random
  -- string that won't collide with the referrer's known devices but still
  -- represents nothing the server has actually observed.
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

  IF p_ip IS NOT NULL AND p_ip <> '' AND p_ip <> 'unknown' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.device_fingerprints
      WHERE user_id = p_referee_id
        AND ip_address = p_ip
    ) INTO v_ip_matches;
    IF NOT v_ip_matches THEN
      RETURN jsonb_build_object('success', false, 'error', 'IP mismatch');
    END IF;
  END IF;

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


-- ── 3. Atomic free-event request reservation -------------------
-- Per-user message cap + per-user rate limit + global pool checks all
-- happen inside one transaction with a row lock on the event row.
-- A small `free_event_user_counters` table tracks per-(event,user)
-- usage so the counter is incrementable atomically without scanning
-- usage_logs.

CREATE TABLE IF NOT EXISTS public.free_event_user_counters (
  event_id UUID NOT NULL REFERENCES public.free_events(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  msg_count INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ,
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.free_event_user_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "free_event_user_counters_service_only" ON public.free_event_user_counters;
CREATE POLICY "free_event_user_counters_service_only"
  ON public.free_event_user_counters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.reserve_free_event_request(
  p_event_id UUID,
  p_user_id  UUID
) RETURNS JSONB AS $$
DECLARE
  v_event RECORD;
  v_now TIMESTAMPTZ := now();
  v_last TIMESTAMPTZ;
  v_count INTEGER;
  v_retry_seconds INTEGER;
BEGIN
  IF p_event_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'Missing params');
  END IF;

  -- Lock the event row so concurrent reservations serialize against the
  -- pool counter check.
  SELECT id, starts_at, ends_at, token_pool_limit, token_pool_used,
         per_user_msg_limit, rate_limit_seconds, is_active
    INTO v_event
  FROM public.free_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF NOT v_event.is_active OR v_event.ends_at < v_now OR v_event.starts_at > v_now THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  IF v_event.token_pool_used >= v_event.token_pool_limit THEN
    RETURN jsonb_build_object('status', 'pool_exhausted');
  END IF;

  -- Lock per-user row (insert if missing).
  INSERT INTO public.free_event_user_counters (event_id, user_id, msg_count)
       VALUES (p_event_id, p_user_id, 0)
  ON CONFLICT (event_id, user_id) DO NOTHING;

  SELECT msg_count, last_request_at
    INTO v_count, v_last
  FROM public.free_event_user_counters
  WHERE event_id = p_event_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_event.rate_limit_seconds > 0 AND v_last IS NOT NULL THEN
    v_retry_seconds := v_event.rate_limit_seconds - extract(epoch FROM (v_now - v_last))::INTEGER;
    IF v_retry_seconds > 0 THEN
      RETURN jsonb_build_object(
        'status', 'rate_limited',
        'retry_after_seconds', v_retry_seconds
      );
    END IF;
  END IF;

  IF v_event.per_user_msg_limit > 0 AND v_count >= v_event.per_user_msg_limit THEN
    RETURN jsonb_build_object(
      'status', 'msg_limit',
      'limit', v_event.per_user_msg_limit,
      'used', v_count
    );
  END IF;

  UPDATE public.free_event_user_counters
     SET msg_count = msg_count + 1,
         last_request_at = v_now
   WHERE event_id = p_event_id AND user_id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'used', v_count + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.reserve_free_event_request(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_free_event_request(UUID, UUID) TO service_role;
