-- ============================================================
-- Atomic reservations for premium RPD and custom-key RPD.
--
-- Prior to this migration, daily request limits and per-minute rate
-- limits were enforced with `SELECT ... FROM usage_logs` BEFORE the
-- upstream call, but usage_logs rows are only written AFTER the
-- upstream response completes (for streams, inside `flush()`). That
-- creates a TOCTOU window of tens of seconds where concurrent or
-- back-to-back requests all observe a stale count and all pass the
-- limit check.
--
-- This migration introduces per-user and per-key counters updated in
-- a single transaction with `FOR UPDATE` row locks. Reservations are
-- refunded if the upstream call fails.
-- ============================================================

-- ------------------------------------------------------------------
-- 1) Counters
-- ------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS premium_requests_today NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_requests_date DATE,
  ADD COLUMN IF NOT EXISTS last_premium_request_at TIMESTAMPTZ;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS requests_today INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requests_date DATE,
  ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMPTZ;

-- ------------------------------------------------------------------
-- 2) Backfill today's counters from usage_logs so the fix doesn't
--    forgive in-flight abuse at deploy time.
-- ------------------------------------------------------------------
UPDATE public.profiles p
SET premium_requests_today = COALESCE(sub.total, 0),
    premium_requests_date = CURRENT_DATE
FROM (
  SELECT user_id, SUM(premium_cost)::NUMERIC(10,2) AS total
  FROM public.usage_logs
  WHERE created_at >= date_trunc('day', (NOW() AT TIME ZONE 'UTC'))
    AND premium_cost > 0
  GROUP BY user_id
) sub
WHERE p.id = sub.user_id;

UPDATE public.api_keys k
SET requests_today = COALESCE(sub.total, 0),
    requests_date = CURRENT_DATE
FROM (
  SELECT api_key_id, COUNT(*)::INTEGER AS total
  FROM public.usage_logs
  WHERE created_at >= date_trunc('day', (NOW() AT TIME ZONE 'UTC'))
  GROUP BY api_key_id
) sub
WHERE k.id = sub.api_key_id
  AND k.is_custom = TRUE;

-- ------------------------------------------------------------------
-- 3) Atomic reservation for premium plan limits.
--    Combines rate-limit and daily-limit checks in a single locked
--    transaction. Returns JSONB with one of:
--      { status: 'ok', used: <numeric> }
--      { status: 'rate_limited', retry_after_seconds: <int> }
--      { status: 'daily_limit', used: <numeric>, "limit": <numeric> }
--      { status: 'not_found' }
-- ------------------------------------------------------------------
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
  v_cost          NUMERIC     := COALESCE(p_cost, 1);
  v_retry_seconds INTEGER;
BEGIN
  IF v_cost <= 0 THEN
    v_cost := 1;
  END IF;

  SELECT premium_requests_today,
         premium_requests_date,
         last_premium_request_at
    INTO v_used, v_date, v_last
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Per-minute (or configured) rate limit. Checked before day rollover
  -- so the caller can't bypass it by crossing UTC midnight.
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

  -- Day rollover: reset the counter before applying the daily check.
  IF v_date IS DISTINCT FROM v_today THEN
    v_used := 0;
  END IF;

  IF COALESCE(p_daily_limit, 0) > 0
     AND v_used + v_cost > p_daily_limit
  THEN
    RETURN jsonb_build_object(
      'status', 'daily_limit',
      'used',   v_used,
      'limit',  p_daily_limit
    );
  END IF;

  UPDATE public.profiles
     SET premium_requests_today  = v_used + v_cost,
         premium_requests_date   = v_today,
         last_premium_request_at = v_now,
         updated_at              = v_now
   WHERE id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'used', v_used + v_cost);
END;
$$;

-- Refund a premium reservation when the upstream call fails.
-- Only touches today's counter — if the day rolled over between
-- reservation and failure, the counter reset will already have zeroed
-- yesterday's inflated value on the next reserve call.
CREATE OR REPLACE FUNCTION public.refund_premium_request(
  p_user_id UUID,
  p_cost    NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
BEGIN
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.profiles
     SET premium_requests_today = GREATEST(0, premium_requests_today - p_cost),
         updated_at             = NOW()
   WHERE id = p_user_id
     AND premium_requests_date = v_today;
END;
$$;

-- ------------------------------------------------------------------
-- 4) Atomic reservation for custom API keys.
--    Counts discrete requests (not premium_cost), since custom keys
--    configure a `daily_request_limit` not a premium budget.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_custom_key_request(
  p_key_id             UUID,
  p_daily_limit        INTEGER,
  p_rate_limit_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_today         DATE        := (v_now AT TIME ZONE 'UTC')::DATE;
  v_used          INTEGER;
  v_date          DATE;
  v_last          TIMESTAMPTZ;
  v_retry_seconds INTEGER;
BEGIN
  SELECT requests_today,
         requests_date,
         last_request_at
    INTO v_used, v_date, v_last
    FROM public.api_keys
   WHERE id = p_key_id
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

  IF COALESCE(p_daily_limit, 0) > 0
     AND v_used + 1 > p_daily_limit
  THEN
    RETURN jsonb_build_object(
      'status', 'daily_limit',
      'used',   v_used,
      'limit',  p_daily_limit
    );
  END IF;

  UPDATE public.api_keys
     SET requests_today  = v_used + 1,
         requests_date   = v_today,
         last_request_at = v_now
   WHERE id = p_key_id;

  RETURN jsonb_build_object('status', 'ok', 'used', v_used + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_custom_key_request(
  p_key_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
BEGIN
  UPDATE public.api_keys
     SET requests_today = GREATEST(0, requests_today - 1)
   WHERE id = p_key_id
     AND requests_date = v_today;
END;
$$;

-- ------------------------------------------------------------------
-- 5) Grants — service role only (route handlers use the admin client).
-- ------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.reserve_premium_request(UUID, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_premium_request(UUID, NUMERIC, NUMERIC, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_premium_request(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_premium_request(UUID, NUMERIC) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reserve_custom_key_request(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_custom_key_request(UUID, INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_custom_key_request(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_custom_key_request(UUID) TO service_role;
