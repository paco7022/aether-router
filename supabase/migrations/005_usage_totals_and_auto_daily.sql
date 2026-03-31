-- ============================================================
-- Fix: Usage totals RPC + Auto-grant daily credits on signup
-- ============================================================

-- RPC to get accurate usage totals (not limited by pagination)
CREATE OR REPLACE FUNCTION get_usage_totals(p_user_id UUID)
RETURNS TABLE(total_tokens BIGINT, total_credits BIGINT, total_requests BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(ul.total_tokens), 0)::BIGINT AS total_tokens,
    COALESCE(SUM(ul.credits_charged), 0)::BIGINT AS total_credits,
    COUNT(*)::BIGINT AS total_requests
  FROM usage_logs ul
  WHERE ul.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix: New users should start with their plan's daily credits, not 0
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  plan_daily BIGINT;
BEGIN
  -- Get daily credits for the free plan
  SELECT credits_per_day INTO plan_daily FROM public.plans WHERE id = 'free';

  INSERT INTO public.profiles (id, email, display_name, plan_id, daily_credits)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'free',
    COALESCE(plan_daily, 0)
  );

  INSERT INTO public.subscriptions (user_id, plan_id, status, last_grant_date)
  VALUES (NEW.id, 'free', 'active', CURRENT_DATE);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
