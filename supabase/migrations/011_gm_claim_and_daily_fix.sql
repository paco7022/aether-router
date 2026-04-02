-- ============================================================
-- Fix: GM claim system for ALL plans + daily credits fix
-- - Add gm_claimed_date column to profiles
-- - Create claim_gm_requests RPC (was missing)
-- - All users must click claim daily to unlock GM requests
-- - Fix claim_daily_credits to properly set daily_credits
-- ============================================================

-- Add gm_claimed_date to profiles (tracks when users last claimed GM requests)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gm_claimed_date DATE;

-- ============================================================
-- RPC: claim_gm_requests
-- ALL users (free and paid) must claim daily to unlock gm/ models.
-- Sets gm_claimed_date = today so the API allows gm/ requests.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_gm_requests(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_plan_id TEXT;
  v_gm_daily_requests INTEGER;
  v_claimed_date DATE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid user id');
  END IF;

  -- Lock the row to prevent double-claim race conditions
  SELECT plan_id, gm_claimed_date
  INTO v_plan_id, v_claimed_date
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Already claimed today
  IF v_claimed_date = CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'success', true,
      'claimed', false,
      'reason', 'Already claimed today'
    );
  END IF;

  -- Get the plan's GM daily request limit
  SELECT gm_daily_requests INTO v_gm_daily_requests
  FROM public.plans
  WHERE id = v_plan_id;

  -- Update claimed date
  UPDATE public.profiles
  SET gm_claimed_date = CURRENT_DATE,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'claimed', true,
    'requests', COALESCE(v_gm_daily_requests, 20)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Fix: claim_daily_credits
-- The existing version uses add_credits (permanent).
-- This fix sets daily_credits (temporary, resets each day).
-- ============================================================
CREATE OR REPLACE FUNCTION claim_daily_credits(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_subscription RECORD;
  v_new_total BIGINT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'claimed', false,
      'error', 'Invalid user id'
    );
  END IF;

  SELECT s.id, s.user_id, s.last_grant_date, p.credits_per_day
  INTO v_subscription
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
  ORDER BY s.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'claimed', false,
      'error', 'No active subscription'
    );
  END IF;

  IF COALESCE(v_subscription.credits_per_day, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'claimed', false,
      'error', 'Current plan has no daily credits'
    );
  END IF;

  IF v_subscription.last_grant_date = CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'success', true,
      'claimed', false,
      'error', 'Daily credits already claimed today'
    );
  END IF;

  -- Set daily_credits (temporary, not permanent) — resets, does not accumulate
  UPDATE public.profiles
  SET daily_credits = v_subscription.credits_per_day,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING daily_credits + credits INTO v_new_total;

  UPDATE public.subscriptions
  SET last_grant_date = CURRENT_DATE,
      credits_granted_today = true,
      updated_at = now()
  WHERE id = v_subscription.id;

  INSERT INTO public.transactions (user_id, amount, balance, type, description)
  VALUES (
    p_user_id,
    v_subscription.credits_per_day,
    v_new_total,
    'daily_grant',
    'Daily credits claimed (expire at end of day)'
  );

  RETURN jsonb_build_object(
    'success', true,
    'claimed', true,
    'daily_credits', v_subscription.credits_per_day,
    'total', v_new_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Restrict to service_role only
REVOKE EXECUTE ON FUNCTION claim_gm_requests(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_gm_requests(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION claim_daily_credits(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_daily_credits(UUID) TO service_role;
