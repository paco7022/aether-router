-- ============================================================
-- Add gm_daily_requests and gm_max_context columns to plans.
-- These were referenced in code but never created.
-- Also lower free plan to 15 requests/day temporarily.
-- ============================================================

-- Add the missing columns.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS gm_daily_requests INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS gm_max_context    INTEGER NOT NULL DEFAULT 32768;

-- Set per-plan limits.
-- Free tier: 15 req/day, 32K context (lowered from default 20).
-- Paid tiers: progressively more generous.
UPDATE plans SET
  gm_daily_requests = CASE id
    WHEN 'free'    THEN 15
    WHEN 'basic'   THEN 30
    WHEN 'pro'     THEN 50
    WHEN 'creator' THEN 80
    WHEN 'master'  THEN 0      -- 0 = unlimited
    WHEN 'ultra'   THEN 0      -- 0 = unlimited
    ELSE 20
  END,
  gm_max_context = CASE id
    WHEN 'free'    THEN 32768
    WHEN 'basic'   THEN 65536
    WHEN 'pro'     THEN 131072
    WHEN 'creator' THEN 131072
    WHEN 'master'  THEN 0      -- 0 = unlimited
    WHEN 'ultra'   THEN 0      -- 0 = unlimited
    ELSE 32768
  END;
