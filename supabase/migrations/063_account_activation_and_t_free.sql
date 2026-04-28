-- ============================================================
-- Account activation gate + mass unban + free t/ migration.
--
-- 1. profiles.is_activated — admin-managed flag. API keys belonging to
--    a free, non-activated user return 403 "pending admin activation".
--    Paid users and anyone who has ever purchased credits or held a
--    subscription are grandfathered to TRUE.
--
-- 2. banned_fingerprints — wiped clean. The new activation gate
--    replaces ban-based abuse mitigation: every free user must now be
--    explicitly approved before their keys work.
--
-- 3. trolllm (t/) goes fully free: cost_per_m_* and premium_request_cost
--    drop to zero so users can drain the upstream keys before they
--    expire. The route handler also short-circuits t/ as a free pool so
--    no credits or premium requests are charged.
-- ============================================================

-- 1. Activation flag.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_activated BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.is_activated IS
  'API-key gate: when false, Bearer-authenticated requests from this user are blocked. Free users start FALSE; paid users are auto-flipped TRUE on Stripe checkout. Admins can toggle from the panel.';

-- Grandfather paid users and anyone with prior purchase/subscription
-- history so we don't lock out customers retroactively.
UPDATE profiles
SET is_activated = TRUE
WHERE plan_id <> 'free'
   OR id IN (
     SELECT DISTINCT user_id FROM subscriptions WHERE plan_id <> 'free'
   )
   OR id IN (
     SELECT DISTINCT user_id FROM transactions
     WHERE type = 'purchase' AND amount > 0
   );

-- 2. Mass unban — start with a clean slate now that the activation gate
-- is the primary abuse barrier.
DELETE FROM banned_fingerprints;

-- 3. trolllm models go to zero-cost. Done in two passes (cost columns +
-- premium cost) for clarity. Inactive rows updated too so a future
-- re-enable picks up the new pricing.
UPDATE models
SET cost_per_m_input       = 0,
    cost_per_m_output      = 0,
    cost_per_m_cache_read  = 0,
    cost_per_m_cache_write = 0,
    premium_request_cost   = 0
WHERE provider = 'trolllm';
