-- ============================================================
-- Billing hardening
-- - Prevent negative/zero amount credit mutations
-- - Add atomic daily-claim RPC used by dashboard API
-- - Restrict sensitive RPC execution to service_role
-- ============================================================

CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount BIGINT)
RETURNS BIGINT AS $$
DECLARE
  cur_daily BIGINT;
  cur_perm BIGINT;
  from_daily BIGINT;
  from_perm BIGINT;
  new_total BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN -1;
  END IF;

  SELECT daily_credits, credits INTO cur_daily, cur_perm
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  IF (cur_daily + cur_perm) < p_amount THEN
    RETURN -1;
  END IF;

  from_daily := LEAST(p_amount, cur_daily);
  from_perm := p_amount - from_daily;

  UPDATE public.profiles
  SET daily_credits = cur_daily - from_daily,
      credits = cur_perm - from_perm,
      updated_at = now()
  WHERE id = p_user_id;

  new_total := (cur_daily - from_daily) + (cur_perm - from_perm);
  RETURN new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION add_credits(p_user_id UUID, p_amount BIGINT)
RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN -1;
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_amount,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
    'Manual daily claim'
  );

  RETURN jsonb_build_object(
    'success', true,
    'claimed', true,
    'daily_credits', v_subscription.credits_per_day,
    'total', v_new_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION deduct_credits(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION deduct_credits(UUID, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION add_credits(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_credits(UUID, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION grant_daily_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION grant_daily_credits() TO service_role;

REVOKE EXECUTE ON FUNCTION claim_daily_credits(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_daily_credits(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION get_usage_totals(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_usage_totals(UUID) TO service_role;
