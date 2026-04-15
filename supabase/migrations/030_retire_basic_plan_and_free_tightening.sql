-- Retire the $3 Basic plan (hidden from listings; row kept so the
-- remaining subscriber's plan_id still resolves until they cancel).
UPDATE plans
SET is_active = false
WHERE id = 'basic';

-- Free plan: drop premium allowance to 15 req/day, tighten premium context to 24k.
UPDATE plans
SET gm_daily_requests = 15,
    gm_max_context = 24576
WHERE id = 'free';
