-- ============================================================
-- DLab (db/) Claude premium_request_cost cut.
--
-- Opus: 12 → 5, Sonnet: 6 → 3.
-- Aligns db/ closer to r/ pricing now that both are paid-only
-- with no per-user gate.
-- ============================================================

UPDATE models SET premium_request_cost = 5 WHERE id IN ('db/claude-opus-4.7', 'db/claude-opus-4.6', 'db/claude-opus-4.5');
UPDATE models SET premium_request_cost = 3 WHERE id IN ('db/claude-sonnet-4.6', 'db/claude-sonnet-4.5');
