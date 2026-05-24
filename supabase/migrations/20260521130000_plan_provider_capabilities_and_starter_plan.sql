-- Plan-level provider capabilities + fair-use counter for "unlimited" cheap providers.
--
--   plans.allowed_providers   : when non-empty, the plan may ONLY use these premium
--                               providers (cheaper tiers gate out the pricier upstreams).
--                               NULL/empty = all providers allowed (backward compatible).
--   plans.unlimited_providers : premium providers that bypass the shared premium-request
--                               pool for this plan (billed as free), guarded instead by a
--                               separate per-user fair-use rate limit + soft daily cap.
--
-- Also: enable unlimited r/ (RiftAI) on every paid plan, and add the $5 "starter" plan
-- (unlimited r/ only — no access to the pricier providers).

-- 1) Plan capability columns (idempotent).
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS allowed_providers   TEXT[],
  ADD COLUMN IF NOT EXISTS unlimited_providers TEXT[];

COMMENT ON COLUMN public.plans.allowed_providers IS
  'When non-empty, the plan may only use these premium providers. NULL/empty = all allowed.';
COMMENT ON COLUMN public.plans.unlimited_providers IS
  'Premium providers that bypass the premium-request pool for this plan (fair-use guarded).';

-- 2) Fair-use counter on profiles. Kept SEPARATE from premium_requests_today so that
--    effectively-free unlimited usage never eats into a plan's metered premium budget.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fairuse_requests_today  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fairuse_requests_date   DATE,
  ADD COLUMN IF NOT EXISTS last_fairuse_request_at TIMESTAMPTZ;

-- 3) Atomic fair-use reservation: per-minute rate limit + soft daily cap + counter
--    increment in one locked transaction. Mirrors reserve_premium_request but counts
--    discrete requests on its own counter. Returns JSONB:
--      { status: 'ok', used }
--      { status: 'rate_limited', retry_after_seconds }
--      { status: 'daily_limit', used, "limit" }
--      { status: 'not_found' }
CREATE OR REPLACE FUNCTION public.reserve_fair_use_request(
  p_user_id            UUID,
  p_daily_limit        INTEGER,
  p_rate_limit_seconds INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now   TIMESTAMPTZ := NOW();
  v_today DATE        := (v_now AT TIME ZONE 'UTC')::DATE;
  v_used  INTEGER;
  v_date  DATE;
  v_last  TIMESTAMPTZ;
  v_retry INTEGER;
BEGIN
  SELECT fairuse_requests_today, fairuse_requests_date, last_fairuse_request_at
    INTO v_used, v_date, v_last
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF COALESCE(p_rate_limit_seconds, 0) > 0
     AND v_last IS NOT NULL
     AND v_now - v_last < make_interval(secs => p_rate_limit_seconds)
  THEN
    v_retry := CEIL(EXTRACT(
      EPOCH FROM (v_last + make_interval(secs => p_rate_limit_seconds) - v_now)
    ))::INTEGER;
    RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', GREATEST(v_retry, 1));
  END IF;

  IF v_date IS DISTINCT FROM v_today THEN
    v_used := 0;
  END IF;

  IF COALESCE(p_daily_limit, 0) > 0
     AND v_used + 1 > p_daily_limit
  THEN
    RETURN jsonb_build_object('status', 'daily_limit', 'used', v_used, 'limit', p_daily_limit);
  END IF;

  UPDATE public.profiles
     SET fairuse_requests_today  = v_used + 1,
         fairuse_requests_date   = v_today,
         last_fairuse_request_at = v_now,
         updated_at              = v_now
   WHERE id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'used', v_used + 1);
END;
$$;

-- Refund a fair-use reservation when the upstream call fails.
CREATE OR REPLACE FUNCTION public.refund_fair_use_request(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
BEGIN
  UPDATE public.profiles
     SET fairuse_requests_today = GREATEST(0, fairuse_requests_today - 1)
   WHERE id = p_user_id
     AND fairuse_requests_date = v_today;
END;
$$;

-- 4) Grants — service role only (route handlers use the admin client).
REVOKE EXECUTE ON FUNCTION public.reserve_fair_use_request(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_fair_use_request(UUID, INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_fair_use_request(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_fair_use_request(UUID) TO service_role;

-- 5) Enable unlimited r/ (RiftAI) on every paid plan. r/ AI cost is ~0; paid plans
--    absorb it so subscriptions cover infra. Metered pool still governs the pricier
--    providers (t/, an/, dlab, …).
UPDATE public.plans
   SET unlimited_providers = ARRAY['riftai']
 WHERE price_usd > 0;

-- 6) $5 Starter plan: unlimited r/ RiftAI only — no access to the pricier providers.
INSERT INTO public.plans (
  id, name, description, price_usd,
  credits_per_day, credits_per_month, bonus_pct,
  is_popular, sort_order, is_active,
  gm_daily_requests, gm_max_context,
  allowed_providers, unlimited_providers
) VALUES (
  'starter', 'Starter', 'Unlimited RiftAI (r/) models — fair use.', 5,
  0, 0, 0,
  false, 1, true,
  0, 32768,
  ARRAY['riftai'], ARRAY['riftai']
)
ON CONFLICT (id) DO UPDATE SET
  name                = EXCLUDED.name,
  description         = EXCLUDED.description,
  price_usd           = EXCLUDED.price_usd,
  credits_per_day     = EXCLUDED.credits_per_day,
  credits_per_month   = EXCLUDED.credits_per_month,
  bonus_pct           = EXCLUDED.bonus_pct,
  is_popular          = EXCLUDED.is_popular,
  sort_order          = EXCLUDED.sort_order,
  is_active           = EXCLUDED.is_active,
  gm_daily_requests   = EXCLUDED.gm_daily_requests,
  gm_max_context      = EXCLUDED.gm_max_context,
  allowed_providers   = EXCLUDED.allowed_providers,
  unlimited_providers = EXCLUDED.unlimited_providers;
