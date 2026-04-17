-- ============================================================
-- Paid referral bonus
-- When a referred user activates a paid subscription (including
-- upgrades — every paid checkout counts), grant +15 premium
-- requests/day for 7 days to BOTH referrer and referee. Stacks
-- on top of any existing bonus window.
-- ============================================================

ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS paid_bonus_granted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.grant_paid_referral_bonus(
  p_referee_id UUID,
  p_bonus      INTEGER DEFAULT 15,
  p_days       INTEGER DEFAULT 7
) RETURNS JSONB AS $$
DECLARE
  v_referral_id UUID;
  v_referrer_id UUID;
  v_new_expires TIMESTAMPTZ;
BEGIN
  IF p_referee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing referee');
  END IF;

  -- Find the valid referral record for this user (if any)
  SELECT id, referrer_id
    INTO v_referral_id, v_referrer_id
  FROM public.referrals
  WHERE referee_id = p_referee_id
    AND status = 'valid'
  LIMIT 1;

  IF v_referral_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No valid referral');
  END IF;

  v_new_expires := now() + (p_days || ' days')::interval;

  -- Referrer bonus (stacks with any active window)
  UPDATE public.profiles SET
    referral_bonus_requests = CASE
      WHEN referral_bonus_expires IS NOT NULL AND referral_bonus_expires > now()
        THEN referral_bonus_requests + p_bonus
      ELSE p_bonus
    END,
    referral_bonus_expires = v_new_expires,
    updated_at = now()
  WHERE id = v_referrer_id;

  -- Referee bonus (symmetric)
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
