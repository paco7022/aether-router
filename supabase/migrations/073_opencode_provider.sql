-- ============================================================
-- OpenCode Go (oc/) provider — premium OpenAI-compatible reseller
--
-- Endpoint: https://opencode.ai/zen/go/v1/chat/completions. Fronts GLM,
-- Kimi, DeepSeek, MiMo and Qwen. Billed as a premium provider: flat
-- 1 credit per request + premium_request_cost against the daily premium
-- pool. Same shape as r/, db/, h/, gm/, w/.
--
-- Upstream is a $10/mo flat-rate plan, so per-token cost columns are
-- left at 0 (no per-token billing for the user either — premium math
-- short-circuits on cost_per_m_input=0 only when premium_request_cost
-- is also 0, which is NOT the case here, so users still pay the
-- per-request credit charge below).
--
-- No Claude exposure on this upstream, so claude-block does not gate it.
--
-- premium_request_cost is a flat 6 credits/request across every oc/ model,
-- per product decision 2026-05-11.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('oc/glm-5.1',          'opencode', 'opencode-go/glm-5.1',          'GLM 5.1',                 0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/glm-5',            'opencode', 'opencode-go/glm-5',            'GLM 5',                   0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/kimi-k2.6',        'opencode', 'opencode-go/kimi-k2.6',        'Kimi K2.6',               0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/kimi-k2.5',        'opencode', 'opencode-go/kimi-k2.5',        'Kimi K2.5',               0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/deepseek-v4-pro',  'opencode', 'opencode-go/deepseek-v4-pro',  'DeepSeek V4 Pro',         0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/deepseek-v4-flash','opencode', 'opencode-go/deepseek-v4-flash','DeepSeek V4 Flash',       0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/mimo-v2.5-pro',    'opencode', 'opencode-go/mimo-v2.5-pro',    'MiMo V2.5 Pro',           0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/mimo-v2.5',        'opencode', 'opencode-go/mimo-v2.5',        'MiMo V2.5',               0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/qwen3.6-plus',     'opencode', 'opencode-go/qwen3.6-plus',     'Qwen 3.6 Plus',           0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('oc/qwen3.5-plus',     'opencode', 'opencode-go/qwen3.5-plus',     'Qwen 3.5 Plus',           0.0000, 0.0000, 0.0000, 0.0000, 1.0000, true, 6.00, '["tool_calling", "streaming", "system_message"]'::jsonb)
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
