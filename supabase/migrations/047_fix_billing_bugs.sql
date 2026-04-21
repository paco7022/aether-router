-- ============================================================
-- Fix production billing bug in reserve_daily_pool_tokens uncovered
-- on 2026-04-21:
--
--   `SELECT used, pool_limit FROM daily_token_pools` was ambiguous
--   because `pool_limit` is both a column on that table AND a column
--   of the function's OUT return record. Postgres raised
--   42702 "column reference pool_limit is ambiguous" whenever the
--   function was called. Qualify every reference with the table alias
--   so the table column is picked.
--
-- NOTE: a separate billing bug caused by PostgREST serializing a NULL
-- composite return from `find_active_free_event` as a truthy all-NULLs
-- object is fixed in the app layer (route.ts) so we don't risk
-- changing the function's return shape.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_daily_pool_tokens(
  p_pool_name TEXT,
  p_user_id UUID,
  p_tokens BIGINT,
  p_pool_default_limit BIGINT DEFAULT 10000000,
  p_user_default_limit BIGINT DEFAULT 200000
)
RETURNS TABLE (
  allowed BOOLEAN,
  pool_used BIGINT,
  pool_limit BIGINT,
  user_used BIGINT,
  user_limit BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool_used BIGINT;
  v_pool_limit BIGINT;
  v_user_used BIGINT;
  v_user_limit BIGINT;
BEGIN
  IF p_pool_name IS NULL OR p_pool_name = '' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'pool_name and user_id are required';
  END IF;

  IF p_tokens IS NULL OR p_tokens <= 0 THEN
    p_tokens := 0;
  END IF;

  INSERT INTO public.daily_token_pools (pool_name, pool_date, used, pool_limit)
  VALUES (p_pool_name, CURRENT_DATE, 0, p_pool_default_limit)
  ON CONFLICT (pool_name, pool_date) DO NOTHING;

  INSERT INTO public.daily_user_token_pools (pool_name, user_id, pool_date, used, user_limit)
  VALUES (p_pool_name, p_user_id, CURRENT_DATE, 0, p_user_default_limit)
  ON CONFLICT (pool_name, user_id, pool_date) DO NOTHING;

  SELECT dtp.used, dtp.pool_limit
    INTO v_pool_used, v_pool_limit
  FROM public.daily_token_pools dtp
  WHERE dtp.pool_name = p_pool_name
    AND dtp.pool_date = CURRENT_DATE
  FOR UPDATE;

  SELECT dutp.used, dutp.user_limit
    INTO v_user_used, v_user_limit
  FROM public.daily_user_token_pools dutp
  WHERE dutp.pool_name = p_pool_name
    AND dutp.user_id = p_user_id
    AND dutp.pool_date = CURRENT_DATE
  FOR UPDATE;

  IF p_tokens = 0 THEN
    RETURN QUERY SELECT TRUE, v_pool_used, v_pool_limit, v_user_used, v_user_limit;
    RETURN;
  END IF;

  IF (v_pool_used + p_tokens > v_pool_limit) OR (v_user_used + p_tokens > v_user_limit) THEN
    RETURN QUERY SELECT FALSE, v_pool_used, v_pool_limit, v_user_used, v_user_limit;
    RETURN;
  END IF;

  UPDATE public.daily_token_pools dtp
  SET used = dtp.used + p_tokens
  WHERE dtp.pool_name = p_pool_name
    AND dtp.pool_date = CURRENT_DATE
  RETURNING dtp.used INTO v_pool_used;

  UPDATE public.daily_user_token_pools dutp
  SET used = dutp.used + p_tokens,
      updated_at = NOW()
  WHERE dutp.pool_name = p_pool_name
    AND dutp.user_id = p_user_id
    AND dutp.pool_date = CURRENT_DATE
  RETURNING dutp.used INTO v_user_used;

  RETURN QUERY SELECT TRUE, v_pool_used, v_pool_limit, v_user_used, v_user_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_daily_pool_tokens(TEXT, UUID, BIGINT, BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_daily_pool_tokens(TEXT, UUID, BIGINT, BIGINT, BIGINT)
  TO service_role;
