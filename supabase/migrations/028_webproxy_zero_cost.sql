-- ============================================================
-- w/gemini: zero upstream cost, minimum charge (1 credit) applies
-- via the existing Math.max(credits, 1) floor. Still counts as
-- 1 premium request (default premium_request_cost).
-- ============================================================

UPDATE models
SET cost_per_m_input = 0,
    cost_per_m_output = 0,
    margin = 0
WHERE id = 'w/gemini';
