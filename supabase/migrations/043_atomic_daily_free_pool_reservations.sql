-- ============================================================
-- Atomic daily free-pool reservations
-- - Prevent race-condition overuse of global and per-user daily free pools
-- - Reserve allowance before upstream request execution
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_user_token_pools (
  pool_name TEXT NOT NULL,
  user_id UUID NOT NULL,
  pool_date DATE NOT NULL DEFAULT CURRENT_DATE,
  used BIGINT NOT NULL DEFAULT 0,
  user_limit BIGINT NOT NULL DEFAULT 200000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_name, user_id, pool_date),
  CONSTRAINT daily_user_token_pools_used_nonnegative CHECK (used >= 0),
  CONSTRAINT daily_user_token_pools_limit_nonnegative CHECK (user_limit >= 0)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_token_pools_user_date
  ON public.daily_user_token_pools (user_id, pool_date DESC);

ALTER TABLE public.daily_user_token_pools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON public.daily_user_token_pools;
CREATE POLICY "service_role_only" ON public.daily_user_token_pools
  FOR ALL USING (auth.role() = 'service_role');

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

  SELECT used, pool_limit
    INTO v_pool_used, v_pool_limit
  FROM public.daily_token_pools
  WHERE pool_name = p_pool_name
    AND pool_date = CURRENT_DATE
  FOR UPDATE;

  SELECT used, user_limit
    INTO v_user_used, v_user_limit
  FROM public.daily_user_token_pools
  WHERE pool_name = p_pool_name
    AND user_id = p_user_id
    AND pool_date = CURRENT_DATE
  FOR UPDATE;

  IF p_tokens = 0 THEN
    RETURN QUERY SELECT TRUE, v_pool_used, v_pool_limit, v_user_used, v_user_limit;
    RETURN;
  END IF;

  IF (v_pool_used + p_tokens > v_pool_limit) OR (v_user_used + p_tokens > v_user_limit) THEN
    RETURN QUERY SELECT FALSE, v_pool_used, v_pool_limit, v_user_used, v_user_limit;
    RETURN;
  END IF;

  UPDATE public.daily_token_pools
  SET used = used + p_tokens
  WHERE pool_name = p_pool_name
    AND pool_date = CURRENT_DATE
  RETURNING used INTO v_pool_used;

  UPDATE public.daily_user_token_pools
  SET used = used + p_tokens,
      updated_at = NOW()
  WHERE pool_name = p_pool_name
    AND user_id = p_user_id
    AND pool_date = CURRENT_DATE
  RETURNING used INTO v_user_used;

  RETURN QUERY SELECT TRUE, v_pool_used, v_pool_limit, v_user_used, v_user_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_daily_pool_tokens(TEXT, UUID, BIGINT, BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_daily_pool_tokens(TEXT, UUID, BIGINT, BIGINT, BIGINT)
  TO service_role;
