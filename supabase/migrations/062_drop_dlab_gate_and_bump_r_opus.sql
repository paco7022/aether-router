-- ============================================================
-- Drop the dlab approval gate and bump RiftAI Opus premium cost.
--
-- 1. profiles.dlab_approved is removed: now that we have a second
--    Claude reseller (r/), db/ falls back to the same paid-only rule
--    as the rest of the premium providers. No per-user opt-in.
--
-- 2. r/claude-opus-* costs more than db/ Opus, bump premium_request_cost
--    from 12 to 15.
-- ============================================================

ALTER TABLE profiles DROP COLUMN IF EXISTS dlab_approved;

UPDATE models
SET premium_request_cost = 15
WHERE provider = 'riftai'
  AND id LIKE 'r/claude-opus-%';
