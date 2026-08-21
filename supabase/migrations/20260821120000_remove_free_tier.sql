-- ============================================================
-- Free tier removal (2026-08-21)
--
-- The `free` plan stops being a product: it no longer routes (hard 402 in
-- src/lib/free-tier.ts, called from /api/v1/chat/completions and media-auth)
-- and it disappears from every plan listing.
--
-- The row itself CANNOT be deleted: profiles.plan_id defaults to 'free' and
-- has an FK to plans(id), so signup and every legacy free account depend on
-- it existing. Deactivating + zeroing it is the removal.
--
-- Also: k/ (kiro community pool) becomes paid-plans-only in the same change,
-- but that lives in code (CLAUDE_PAID_ONLY_BYPASS in src/lib/claude-block.ts),
-- not here — k/ pricing (Opus 6 / Sonnet 3) is unchanged.
--
-- To revert: is_active = true + restore credits_per_day/gm_daily_requests,
-- and drop the gate call sites in the router.
-- ============================================================

-- 1. Hide `free` from every plan listing. RLS on plans is
--    "Anyone can view active plans", so this also stops the browser from
--    reading the row at all (billing page, gift picker, register page).
--    The hot path (plan-cache.getPlanLimits) reads by id via the service
--    role and does NOT filter is_active, so routing limits are unaffected.
UPDATE plans
SET is_active = false
WHERE id = 'free';

-- 2. Zero the free allowances. Belt and braces: if the router gate is ever
--    reverted by accident, a free account still gets nothing included
--    instead of silently going back to 15 premium requests/day.
UPDATE plans
SET credits_per_day   = 0,
    credits_per_month = 0,
    gm_daily_requests = 0
WHERE id = 'free';

-- 3. Turn off promo events that only ever targeted the free plan. Events
--    aimed at all plans (target_plan_ids IS NULL) or at paid tiers are left
--    alone — those are still live benefits for paying users.
UPDATE free_events
SET is_active = false
WHERE is_active
  AND target_plan_ids IS NOT NULL
  AND target_plan_ids <@ ARRAY['free']::text[];
