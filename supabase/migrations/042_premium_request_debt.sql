-- ============================================================
-- Premium request debt: a persistent counter that adds to
-- `premium_requests_today` when checking the daily premium cap.
--
-- Used to penalize users who bypassed the context cap via
-- multimodal content / tool definitions that the pre-check
-- estimator didn't catch (see migration 042 companion app fix).
--
-- Day rollover does NOT reset debt — only `premium_requests_today`.
-- Admin clears debt manually via UPDATE.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS premium_request_debt NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.reserve_premium_request(
  p_user_id            UUID,
  p_cost               NUMERIC,
  p_daily_limit        NUMERIC,
  p_rate_limit_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_today         DATE        := (v_now AT TIME ZONE 'UTC')::DATE;
  v_used          NUMERIC;
  v_date          DATE;
  v_last          TIMESTAMPTZ;
  v_debt          NUMERIC;
  v_cost          NUMERIC     := COALESCE(p_cost, 1);
  v_retry_seconds INTEGER;
BEGIN
  IF v_cost <= 0 THEN
    v_cost := 1;
  END IF;

  SELECT premium_requests_today,
         premium_requests_date,
         last_premium_request_at,
         premium_request_debt
    INTO v_used, v_date, v_last, v_debt
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
    v_retry_seconds := CEIL(EXTRACT(
      EPOCH FROM (v_last + make_interval(secs => p_rate_limit_seconds) - v_now)
    ))::INTEGER;
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', GREATEST(v_retry_seconds, 1)
    );
  END IF;

  IF v_date IS DISTINCT FROM v_today THEN
    v_used := 0;
  END IF;

  -- Debt counts against the daily cap. A user with debt > daily_limit
  -- is effectively blocked from premium until admin clears the debt.
  IF COALESCE(p_daily_limit, 0) > 0
     AND v_used + COALESCE(v_debt, 0) + v_cost > p_daily_limit
  THEN
    RETURN jsonb_build_object(
      'status', 'daily_limit',
      'used',   v_used,
      'debt',   COALESCE(v_debt, 0),
      'limit',  p_daily_limit
    );
  END IF;

  UPDATE public.profiles
     SET premium_requests_today  = v_used + v_cost,
         premium_requests_date   = v_today,
         last_premium_request_at = v_now,
         updated_at              = v_now
   WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'used',   v_used + v_cost,
    'debt',   COALESCE(v_debt, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_premium_request(UUID, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_premium_request(UUID, NUMERIC, NUMERIC, INTEGER) TO service_role;
