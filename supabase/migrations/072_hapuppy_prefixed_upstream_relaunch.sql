-- ============================================================
-- Hapuppy h/ Claude relaunch: upstream now expects "hapuppy/<model>"
-- as the literal model string. Bump premium_request_cost to match
-- the new upstream pricing and reactivate.
--
--   h/claude-opus-4-7   upstream "hapuppy/claude-opus-4-7"   cost 20
--   h/claude-opus-4-6   upstream "hapuppy/claude-opus-4-6"   cost 20
--   h/claude-sonnet-4-6 upstream "hapuppy/claude-sonnet-4-6" cost 12
-- ============================================================

UPDATE models
SET upstream_model_id    = 'hapuppy/claude-opus-4-7',
    premium_request_cost = 20,
    is_active            = true
WHERE id = 'h/claude-opus-4-7';

UPDATE models
SET upstream_model_id    = 'hapuppy/claude-opus-4-6',
    premium_request_cost = 20,
    is_active            = true
WHERE id = 'h/claude-opus-4-6';

UPDATE models
SET upstream_model_id    = 'hapuppy/claude-sonnet-4-6',
    premium_request_cost = 12,
    is_active            = true
WHERE id = 'h/claude-sonnet-4-6';
