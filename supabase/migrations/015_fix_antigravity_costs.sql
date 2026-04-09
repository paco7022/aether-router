-- ============================================================
-- Fix Antigravity model costs: should be 0 (free to us)
-- and margin 1.0. Each request still counts as 1 premium request.
-- ============================================================

UPDATE models
SET cost_per_m_input  = 0,
    cost_per_m_output = 0,
    margin            = 1.0
WHERE provider = 'antigravity';
