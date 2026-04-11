-- ============================================================
-- Add +20 daily premium requests to all paid plans as
-- compensation for not offering a guarantee.
-- Free plan is excluded (not paying).
-- Ultimate plan is excluded (already unlimited, gm_daily_requests = 0).
-- ============================================================

UPDATE plans
SET gm_daily_requests = gm_daily_requests + 20
WHERE id IN ('basic', 'pro', 'creator', 'master', 'ultra');
