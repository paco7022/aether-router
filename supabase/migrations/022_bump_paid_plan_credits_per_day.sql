-- ============================================================
-- Bump credits_per_day by +20 on paid plans to match the
-- +20 gm_daily_requests bump from migration 021 (compensation
-- for no uptime guarantee). credits_per_month stays in sync
-- (credits_per_day * 30).
-- Free and Ultimate excluded (same rationale as 021).
-- ============================================================

UPDATE plans
SET credits_per_day   = credits_per_day + 20,
    credits_per_month = (credits_per_day + 20) * 30
WHERE id IN ('basic', 'pro', 'creator', 'master', 'ultra');
