-- ============================================================
-- rout.my (rt/) — OpenAI GPT-5.x models
--
-- Adds OpenAI models fronted by api.rout.my. Billed as premium-pool
-- like the rest of rt/: flat 1 credit + premium_request_cost against
-- the daily premium pool. Per-token cost_per_m stays 0 on purpose.
--
-- premium_request_cost = the x-multiplier from the provider price list:
--   gpt-5.5 → x7 (7.00)   ·   gpt-5.4 / gpt-5.3-chat / gpt-5.3-codex → x3 (3.00)
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  -- x7
  ('rt/openai/gpt-5.5',       'routmy', 'openai/gpt-5.5',       'GPT-5.5',        0, 0, 0, 0, 1.5500, true, 7.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb),
  -- x3
  ('rt/openai/gpt-5.4',       'routmy', 'openai/gpt-5.4',       'GPT-5.4',        0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb),
  ('rt/openai/gpt-5.3-chat',  'routmy', 'openai/gpt-5.3-chat',  'GPT-5.3 Chat',   0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb),
  ('rt/openai/gpt-5.3-codex', 'routmy', 'openai/gpt-5.3-codex', 'GPT-5.3 Codex',  0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb)
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
