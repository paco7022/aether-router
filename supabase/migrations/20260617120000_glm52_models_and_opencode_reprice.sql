-- ============================================================
-- GLM 5.2 across r/ + rt/ + oc/, and OpenCode repricing to x3
--
-- New model GLM 5.2 (z.ai) confirmed live on all three upstream
-- catalogs (riftai.su, api.rout.my, opencode.ai/zen/go):
--   r/glm-5.2        -> riftai   upstream 'glm-5.2'      x2
--   rt/z-ai/glm-5.2  -> routmy   upstream 'z-ai/glm-5.2' x2
--   oc/glm-5.2       -> opencode upstream 'glm-5.2'      x3
--
-- All three are premium-pool providers: flat 1 credit/request +
-- premium_request_cost against the daily pool, no per-token billing
-- (cost_per_m left at 0). premium_request_cost = the xN multiplier.
--
-- Per-provider margin convention is preserved: riftai/opencode = 1.00,
-- routmy = 1.55 (matches 20260607120000_routmy_provider.sql).
--
-- Second change: ALL oc/ (opencode) models drop from x6 -> x3 per
-- product decision 2026-06-17 (supersedes the flat 6 from
-- 073_opencode_provider.sql). The new oc/glm-5.2 row already lands at 3.
-- ============================================================

-- New GLM 5.2 rows
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('r/glm-5.2',       'riftai',   'glm-5.2',       'GLM 5.2', 0, 0, 0, 0, 1.0000, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/z-ai/glm-5.2', 'routmy',   'z-ai/glm-5.2',  'GLM 5.2', 0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/glm-5.2',      'opencode', 'glm-5.2',       'GLM 5.2', 0, 0, 0, 0, 1.0000, true, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  provider               = EXCLUDED.provider,
  upstream_model_id      = EXCLUDED.upstream_model_id,
  display_name           = EXCLUDED.display_name,
  cost_per_m_input       = EXCLUDED.cost_per_m_input,
  cost_per_m_output      = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read  = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write = EXCLUDED.cost_per_m_cache_write,
  margin                 = EXCLUDED.margin,
  is_active              = EXCLUDED.is_active,
  premium_request_cost   = EXCLUDED.premium_request_cost,
  capabilities           = EXCLUDED.capabilities;

-- Reprice every OpenCode model to x3
UPDATE models
SET premium_request_cost = 3.00
WHERE provider = 'opencode';
