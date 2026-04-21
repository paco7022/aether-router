-- ============================================================
-- Plan price and limit restructure (2026-04-21)
--
-- - pro      : $6  -> $8,  85/day -> 75/day   (context unchanged)
-- - creator  : $12 -> $15, 145/day -> 140/day (context unchanged)
-- - master   : $25 -> $30, requests & context unchanged
-- - ultra    : no change (included for completeness)
-- - ultimate : was "unlimited" (gm_daily_requests=0, gm_max_context=0)
--              now capped at 1000 req/day and 200k context
-- - max      : NEW plan at $200, 2000 req/day, 200k context
--
-- credits_per_day mirrors gm_daily_requests (follows current plan pattern
-- where 1 credit ≈ 1 premium request for paid plans). credits_per_month
-- is credits_per_day * 30.
--
-- NOTE on billing impact: Stripe checkout uses `price_data` inline (not a
-- pre-configured Price ID), so active subscriptions stay on the price
-- they signed up at — only NEW subscriptions hit the new pricing. If a
-- grandfathered user downgrades/resubscribes through the portal, Stripe
-- will reuse the existing subscription price until the user cancels and
-- resubscribes from scratch.
-- ============================================================

UPDATE plans
SET price_usd = 8,
    credits_per_day = 75,
    credits_per_month = 2250,
    gm_daily_requests = 75
WHERE id = 'pro';

UPDATE plans
SET price_usd = 15,
    credits_per_day = 140,
    credits_per_month = 4200,
    gm_daily_requests = 140
WHERE id = 'creator';

UPDATE plans
SET price_usd = 30
WHERE id = 'master';

-- ultimate: was marked "unlimited" with gm_daily_requests=0 and
-- gm_max_context=0. Impose hard caps now.
UPDATE plans
SET credits_per_day = 1000,
    credits_per_month = 30000,
    gm_daily_requests = 1000,
    gm_max_context = 200000
WHERE id = 'ultimate';

-- New top tier.
INSERT INTO plans (
  id, name, description, price_usd,
  credits_per_day, credits_per_month, bonus_pct,
  is_popular, sort_order, is_active,
  gm_daily_requests, gm_max_context
) VALUES (
  'max', 'Max', 'Power users — 2000 premium requests/day and 200k context.',
  200,
  2000, 60000, 0,
  false, 7, true,
  2000, 200000
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_usd = EXCLUDED.price_usd,
  credits_per_day = EXCLUDED.credits_per_day,
  credits_per_month = EXCLUDED.credits_per_month,
  bonus_pct = EXCLUDED.bonus_pct,
  is_popular = EXCLUDED.is_popular,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  gm_daily_requests = EXCLUDED.gm_daily_requests,
  gm_max_context = EXCLUDED.gm_max_context;
