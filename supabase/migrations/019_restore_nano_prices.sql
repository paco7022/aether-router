-- ============================================================
-- Restore nano model prices.
--
-- Nano reverts to "first 200k tokens/day per user free, then
-- pay-as-you-go" semantics, so we need real prices back on the
-- Models page. Margin stays at 5% over upstream cost.
-- ============================================================

UPDATE models SET cost_per_m_input = 0.24, cost_per_m_output = 1.52, margin = 1.05 WHERE id = 'na/kimi-k2.5';
UPDATE models SET cost_per_m_input = 0.24, cost_per_m_output = 1.52, margin = 1.05 WHERE id = 'na/kimi-k2.5-thinking';
UPDATE models SET cost_per_m_input = 0.13, cost_per_m_output = 0.68, margin = 1.05 WHERE id = 'na/glm-4.7';
UPDATE models SET cost_per_m_input = 0.26, cost_per_m_output = 2.17, margin = 1.05 WHERE id = 'na/glm-5';
UPDATE models SET cost_per_m_input = 0.09, cost_per_m_output = 0.36, margin = 1.05 WHERE id = 'na/deepseek-v3-0324';
UPDATE models SET cost_per_m_input = 0.34, cost_per_m_output = 1.44, margin = 1.05 WHERE id = 'na/deepseek-r1-0528';
