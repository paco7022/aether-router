-- ============================================================
-- Unified daily token pools for free-tier models.
--
-- Each pool has a global per-day token budget (default 10M).
-- Per-user daily caps are enforced in the API layer (200k).
-- Used for:
--   - nano          (na/ models)
--   - deepseek-v3.2 (airforce a/deepseek-v3.2)
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_token_pools (
  pool_name  TEXT NOT NULL,
  pool_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  used       BIGINT NOT NULL DEFAULT 0,
  pool_limit BIGINT NOT NULL DEFAULT 10000000,
  PRIMARY KEY (pool_name, pool_date)
);

ALTER TABLE daily_token_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON daily_token_pools
  FOR ALL USING (auth.role() = 'service_role');

-- Nano is now fully free with daily caps (was pay-as-you-go).
-- Zero out displayed costs and margin so the dashboard reflects reality.
UPDATE models
SET cost_per_m_input = 0,
    cost_per_m_output = 0,
    margin = 1.0
WHERE provider = 'nano';
