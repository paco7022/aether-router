-- ============================================================
-- k/ (kiro community pool) — reprice to the standard premium tiers
--
-- k/ launched at a flat 0.50 premium_request_cost across the board while it was
-- being seeded as a community pool. Standardising it on the same tiers every
-- other Claude provider uses:
--   Claude Opus   (4.5 / 4.6 / 4.7 / 4.8) → 6
--   Claude Sonnet (4.5 / 4.6 / 5)         → 3
--
-- NOTE: kiro remains in CLAUDE_PAID_ONLY_BYPASS + CLAUDE_ACTIVATION_BYPASS
-- (see src/lib/claude-block.ts), so free users can still route Claude here —
-- they now just pay the standard 6/3 premium-request price for it instead of
-- 0.50. Flip those sets if free access should close too.
--
-- DB-only: premium_request_cost is read from the models table at request time,
-- no deploy required.
-- ============================================================

UPDATE models SET premium_request_cost = 6.00
WHERE provider = 'kiro' AND id ILIKE '%opus%';

UPDATE models SET premium_request_cost = 3.00
WHERE provider = 'kiro' AND id ILIKE '%sonnet%';
