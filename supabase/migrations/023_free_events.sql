-- ============================================================
-- Free Events — admin-created, time-windowed pools that make a
-- given model prefix free for a set of plans with their own
-- per-user limits (messages, context, rate) and a global token
-- budget.
--
-- Example: for the next 2 hours, gm/* is free for free-tier users,
-- each capped at 20 messages / 32k context / 1 req per 120s, with
-- a global 5M token budget for the whole event.
-- ============================================================

CREATE TABLE IF NOT EXISTS free_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  model_prefix          TEXT NOT NULL,                      -- e.g. 'gm/', 'c/', 'an/', 'na/' or a full model id
  target_plan_ids       TEXT[],                             -- NULL = all plans; otherwise restrict to listed plan ids
  starts_at             TIMESTAMPTZ NOT NULL,
  ends_at               TIMESTAMPTZ NOT NULL,
  token_pool_limit      BIGINT NOT NULL DEFAULT 5000000,    -- global token budget
  token_pool_used       BIGINT NOT NULL DEFAULT 0,
  per_user_msg_limit    INTEGER NOT NULL DEFAULT 20,        -- 0 = unlimited
  max_context           INTEGER NOT NULL DEFAULT 32768,     -- 0 = unlimited
  rate_limit_seconds    INTEGER NOT NULL DEFAULT 120,       -- 0 = no rate limit
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            TEXT,                               -- admin email for audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT free_events_valid_window CHECK (ends_at > starts_at)
);

-- Partial index optimised for the hot-path "find active event" query.
CREATE INDEX IF NOT EXISTS idx_free_events_active
  ON free_events (model_prefix, ends_at)
  WHERE is_active = TRUE;

ALTER TABLE free_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON free_events
  FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- Find the first active event that covers (model_id, plan_id) at
-- the current moment. The API layer passes the full model_id; we
-- match by prefix. Returns at most one row (the newest active one
-- in case multiple overlap).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_active_free_event(
  p_model_id TEXT,
  p_plan_id  TEXT
)
RETURNS free_events
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM free_events
  WHERE is_active = TRUE
    AND NOW() BETWEEN starts_at AND ends_at
    AND p_model_id LIKE model_prefix || '%'
    AND (target_plan_ids IS NULL OR p_plan_id = ANY(target_plan_ids))
    AND token_pool_used < token_pool_limit
  ORDER BY created_at DESC
  LIMIT 1;
$$;

-- ------------------------------------------------------------
-- Atomically add tokens to an event's used counter. No-op if the
-- event has already hit its limit (we still log usage, but don't
-- keep inflating the counter past the limit).
-- ------------------------------------------------------------
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
    SELECT token_pool_used INTO new_used FROM free_events WHERE id = p_event_id;
    RETURN new_used;
  END IF;

  UPDATE free_events
  SET    token_pool_used = token_pool_used + p_tokens
  WHERE  id = p_event_id
  RETURNING token_pool_used INTO new_used;

  RETURN new_used;
END;
$$;
