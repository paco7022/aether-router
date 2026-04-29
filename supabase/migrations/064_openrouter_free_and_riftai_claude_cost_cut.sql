-- ============================================================
-- OpenRouter free models (op/) + RiftAI Claude cost experiment
--
-- 1. Add six free-tier OpenRouter models under the op/ prefix.
--    These are routed through the openrouter provider and billed
--    as flat-rate: 0.1 credits per request, no context limit from
--    our side, no premium-request pool consumption.
--    Upstream cost is $0 (free-tier models on OpenRouter).
--
-- 2. Reduce r/ (RiftAI) Claude models' premium_request_cost by ~7x
--    as an experiment. Opus: 15 → 2, Sonnet: 8 → 1.
-- ============================================================

-- OpenRouter free models
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, context_length, capabilities
) VALUES
  ('op/hermes-3-405b',               'openrouter', 'nousresearch/hermes-3-llama-3.1-405b:free',  'Hermes 3 405B (Free)',             0, 0, 0, 0, 1.00, true, 0.10, 131072, '["streaming", "system_message", "tool_calling"]'::jsonb),
  ('op/gemma-4-31b',                 'openrouter', 'google/gemma-4-31b-it:free',                 'Gemma 4 31B (Free)',               0, 0, 0, 0, 1.00, true, 0.10, 131072, '["streaming", "system_message"]'::jsonb),
  ('op/minimax-m2.5',                 'openrouter', 'minimax/minimax-m2.5:free',                   'MiniMax M2.5 (Free)',             0, 0, 0, 0, 1.00, true, 0.10, 1048576, '["streaming", "system_message", "vision"]'::jsonb),
  ('op/glm-4.5-air',                  'openrouter', 'z-ai/glm-4.5-air:free',                      'GLM 4.5 Air (Free)',              0, 0, 0, 0, 1.00, true, 0.10, 131072, '["streaming", "system_message"]'::jsonb),
  ('op/nemotron-3-super-120b',         'openrouter', 'nvidia/nemotron-3-super-120b-a12b:free',      'Nemotron 3 Super 120B (Free)',     0, 0, 0, 0, 1.00, true, 0.10, 4096, '["streaming", "system_message"]'::jsonb),
  ('op/qwen3-coder',                  'openrouter', 'qwen/qwen3-coder:free',                      'Qwen3 Coder (Free)',              0, 0, 0, 0, 1.00, true, 0.10, 131072, '["streaming", "system_message", "tool_calling"]'::jsonb)
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
  context_length         = EXCLUDED.context_length,
  capabilities           = EXCLUDED.capabilities;

-- Reduce r/ Claude premium_request_cost: Opus x7, Sonnet x3
UPDATE models SET premium_request_cost = 7 WHERE id IN ('r/claude-opus-4-7', 'r/claude-opus-4-6', 'r/claude-opus-4-5');
UPDATE models SET premium_request_cost = 3 WHERE id IN ('r/claude-sonnet-4-6', 'r/claude-sonnet-4-5');