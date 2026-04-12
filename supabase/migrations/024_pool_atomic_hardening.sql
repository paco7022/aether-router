-- ============================================================
-- Pool hardening
-- - Make free-event token increments bounded and race-safe
-- - Add atomic increment helpers for daily token pools
-- - Add atomic increment helper for lightningzeus pool
-- ============================================================

-- Keep the same signature used by the API route.
-- Behavior:
-- - p_tokens <= 0: return current usage unchanged
-- - normal path: increment up to token_pool_limit (never above)
-- - if already exhausted: no-op and return current value
CREATE OR REPLACE FUNCTION increment_free_event_tokens(
  p_event_id UUID,
  p_tokens   BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  new_used BIGINT;
BEGIN
  IF p_tokens <= 0 THEN
    SELECT token_pool_used INTO new_used
    FROM free_events
    WHERE id = p_event_id;
    RETURN COALESCE(new_used, 0);
  END IF;

  UPDATE free_events
  SET token_pool_used = LEAST(token_pool_limit, token_pool_used + p_tokens)
  WHERE id = p_event_id
    AND token_pool_used < token_pool_limit
  RETURNING token_pool_used INTO new_used;

  IF new_used IS NULL THEN
    SELECT token_pool_used INTO new_used
    FROM free_events
    WHERE id = p_event_id;
  END IF;

  RETURN COALESCE(new_used, 0);
END;
$$;

-- Atomic increment for (pool_name, CURRENT_DATE) in daily_token_pools.
CREATE OR REPLACE FUNCTION increment_daily_token_pool(
  p_pool_name TEXT,
  p_tokens BIGINT,
  p_default_limit BIGINT DEFAULT 10000000
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  new_used BIGINT;
BEGIN
  IF p_tokens <= 0 THEN
    SELECT used INTO new_used
    FROM daily_token_pools
    WHERE pool_name = p_pool_name
      AND pool_date = CURRENT_DATE;
    RETURN COALESCE(new_used, 0);
  END IF;

  INSERT INTO daily_token_pools (pool_name, pool_date, used, pool_limit)
  VALUES (p_pool_name, CURRENT_DATE, p_tokens, p_default_limit)
  ON CONFLICT (pool_name, pool_date)
  DO UPDATE SET used = daily_token_pools.used + EXCLUDED.used
  RETURNING used INTO new_used;

  RETURN COALESCE(new_used, 0);
END;
$$;

-- Atomic increment for lightningzeus_daily_pool on CURRENT_DATE.
CREATE OR REPLACE FUNCTION increment_lightningzeus_pool(
  p_increment INTEGER DEFAULT 1,
  p_default_limit INTEGER DEFAULT 3000
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  inc_value INTEGER;
  new_used INTEGER;
BEGIN
  inc_value := GREATEST(p_increment, 0);

  IF inc_value = 0 THEN
    SELECT used INTO new_used
    FROM lightningzeus_daily_pool
    WHERE pool_date = CURRENT_DATE;
    RETURN COALESCE(new_used, 0);
  END IF;

  INSERT INTO lightningzeus_daily_pool (pool_date, used, pool_limit)
  VALUES (CURRENT_DATE, inc_value, p_default_limit)
  ON CONFLICT (pool_date)
  DO UPDATE SET used = lightningzeus_daily_pool.used + EXCLUDED.used
  RETURNING used INTO new_used;

  RETURN COALESCE(new_used, 0);
END;
$$;
