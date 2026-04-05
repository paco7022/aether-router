-- ============================================================
-- Add gm_daily_requests and gm_max_context columns to plans
-- (if they don't already exist) and lower free plan to 15 req/day.
-- Paid plans are NOT touched.
-- ============================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS gm_daily_requests INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS gm_max_context    INTEGER NOT NULL DEFAULT 32768;

-- Only change the free plan: 20 -> 15 requests/day.
UPDATE plans
SET gm_daily_requests = 15
WHERE id = 'free';
