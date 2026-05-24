-- Pause free included usage while traffic/cost controls are rebalanced.
--
-- App-level gates are controlled by:
--   AETHER_FREE_INCLUDED_USAGE_ENABLED=false (default)
--   AETHER_FREE_PROMOS_ENABLED=false (default)
--
-- This migration makes the database match that posture:
--   - new/free subscriptions cannot claim daily credits
--   - current free users lose temporary daily_credits
--   - free plan's visible premium allowance is zeroed
--   - paid-only credit deduction is available for free-plan users who buy credits

UPDATE public.plans
SET credits_per_day = 0,
    credits_per_month = 0,
    gm_daily_requests = 0
WHERE id = 'free';

UPDATE public.profiles
SET daily_credits = 0,
    updated_at = now()
WHERE plan_id = 'free'
  AND daily_credits <> 0;

CREATE OR REPLACE FUNCTION public.deduct_paid_credits(p_user_id UUID, p_amount BIGINT)
RETURNS BIGINT AS $$
DECLARE
  v_daily BIGINT;
  v_credits BIGINT;
  v_new_total BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN -1;
  END IF;

  SELECT daily_credits, credits
  INTO v_daily, v_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  IF v_credits < p_amount THEN
    RETURN -1;
  END IF;

  UPDATE public.profiles
  SET credits = v_credits - p_amount,
      updated_at = now()
  WHERE id = p_user_id;

  v_new_total := v_daily + (v_credits - p_amount);
  RETURN v_new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.deduct_paid_credits(UUID, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_paid_credits(UUID, BIGINT)
  TO service_role;
