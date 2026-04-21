-- ============================================================
-- Bump h/ opus premium_request_cost by +2 across the board.
-- Hapuppy Opus is more expensive than we priced it on launch; the
-- +2 brings each opus SKU closer to the actual upstream cost.
--
--   h/claude-opus-4-5-20251101: 6 -> 8
--   h/claude-opus-4-6:          6 -> 8
--   h/claude-opus-4-7:          8 -> 10
--
-- Sonnet and non-Claude models on h/ are left unchanged.
-- ============================================================

UPDATE models
SET premium_request_cost = premium_request_cost + 2
WHERE provider = 'hapuppy'
  AND id LIKE 'h/claude-opus-%';
