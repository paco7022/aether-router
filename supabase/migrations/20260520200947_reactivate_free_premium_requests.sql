-- Reactivate the only free included usage: 15 premium-request units/day.
--
-- Free daily credits and promotional free pools stay disabled:
--   AETHER_FREE_INCLUDED_USAGE_ENABLED=true
--   AETHER_FREE_PROMOS_ENABLED=false
--
-- This keeps free users on the premium request pool while preventing any
-- daily credit grants or zero-cost model promotions from becoming free again.

UPDATE public.plans
SET credits_per_day = 0,
    credits_per_month = 0,
    gm_daily_requests = 15
WHERE id = 'free';

UPDATE public.profiles
SET daily_credits = 0,
    updated_at = now()
WHERE plan_id = 'free'
  AND daily_credits <> 0;

-- If someone clicked the premium claim while the free plan allowance was
-- paused at 0, let them claim the restored 15-request allowance today.
UPDATE public.profiles
SET gm_claimed_date = NULL,
    updated_at = now()
WHERE plan_id = 'free'
  AND gm_claimed_date = CURRENT_DATE;
