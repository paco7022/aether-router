-- ============================================================
-- Temporary vs Permanent Credits
-- ============================================================
-- "credits" = permanent (purchased, never expire)
-- "daily_credits" = temporary (from plan, reset daily)
-- Daily credits are consumed first, then permanent.

ALTER TABLE profiles ADD COLUMN daily_credits BIGINT NOT NULL DEFAULT 0;

-- Updated deduct function: consume daily (temporary) credits first, then permanent
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount BIGINT)
RETURNS BIGINT AS $$
DECLARE
  cur_daily BIGINT;
  cur_perm BIGINT;
  from_daily BIGINT;
  from_perm BIGINT;
  new_total BIGINT;
BEGIN
  SELECT daily_credits, credits INTO cur_daily, cur_perm
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RETURN -1; END IF;

  -- Check total balance
  IF (cur_daily + cur_perm) < p_amount THEN
    RETURN -1;
  END IF;

  -- Consume daily credits first
  from_daily := LEAST(p_amount, cur_daily);
  from_perm := p_amount - from_daily;

  UPDATE profiles
  SET daily_credits = cur_daily - from_daily,
      credits = cur_perm - from_perm,
      updated_at = now()
  WHERE id = p_user_id;

  new_total := (cur_daily - from_daily) + (cur_perm - from_perm);
  RETURN new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant daily credits: reset daily_credits to plan allowance (not accumulate)
CREATE OR REPLACE FUNCTION grant_daily_credits()
RETURNS INTEGER AS $$
DECLARE
  granted INTEGER := 0;
  sub RECORD;
BEGIN
  FOR sub IN
    SELECT s.id, s.user_id, p.credits_per_day
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.status = 'active'
      AND p.credits_per_day > 0
      AND (s.last_grant_date IS NULL OR s.last_grant_date < CURRENT_DATE)
  LOOP
    -- Set daily credits (reset, not accumulate)
    UPDATE profiles
    SET daily_credits = sub.credits_per_day, updated_at = now()
    WHERE id = sub.user_id;

    -- Log transaction
    INSERT INTO transactions (user_id, amount, balance, type, description)
    SELECT sub.user_id, sub.credits_per_day,
           p.daily_credits + p.credits,
           'daily_grant', 'Daily plan credits (expire at end of day)'
    FROM profiles p WHERE p.id = sub.user_id;

    -- Mark as granted
    UPDATE subscriptions
    SET last_grant_date = CURRENT_DATE,
        credits_granted_today = true,
        updated_at = now()
    WHERE id = sub.id;

    granted := granted + 1;
  END LOOP;

  -- Reset flag for tomorrow
  UPDATE subscriptions
  SET credits_granted_today = false
  WHERE credits_granted_today = true
    AND last_grant_date < CURRENT_DATE;

  RETURN granted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
