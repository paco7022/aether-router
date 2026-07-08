-- ============================================================
-- sh00t.host (sh/) provider — premium OpenAI-compatible reseller
--
-- Endpoint: https://sh00t.host/v1/chat/completions. Fronts a mixed catalog:
-- Anthropic Claude Opus 4.6–4.8, OpenAI GPT-5.5, Google Gemini 3.x,
-- DeepSeek V4, z.ai GLM-5.2, Moonshot Kimi K2.7, MiniMax M-3.
-- Same shape as r/, t/, or/, rt/, z/. Billed as a premium provider:
-- flat 1 credit per request + premium_request_cost against the daily
-- premium pool.
--
-- Per-token cost_per_m left at 0 on purpose: premium-pool providers charge
-- via premium_request_cost only, never per-token. (The upstream also inflates
-- reported input tokens heavily by injecting its own system prompt, so per-
-- token billing would be wrong anyway.)
--
-- premium_request_cost = the x-multiplier tier (set by owner 2026-07-08):
--   Claude Opus / GPT-5.5 → 3
--   DeepSeek V4 (flash+pro) / GLM 5.2 (+fast) → 2
--   Gemini 3 Flash / Gemini 3.1 Pro / Kimi K2.7 / MiniMax M-3 → 1
--
-- KEY: SHOOT_API_KEY is kept isolated in its own env var, never folded into a
-- shared pool. upstream_model_id is the exact id returned by /v1/models.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  -- x1
  ('sh/gemini-3-flash-preview',   'shoot', 'gemini-3-flash-preview',   'Gemini 3 Flash (Preview)', 0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/gemini-3.1-pro-preview',   'shoot', 'gemini-3.1-pro-preview',   'Gemini 3.1 Pro (Preview)', 0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/kimi-k2-7-code',           'shoot', 'kimi-k2-7-code',           'Kimi K2.7 Code',           0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/minimax-m-3',              'shoot', 'minimax-m-3',              'MiniMax M-3',              0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- x2
  ('sh/deepseek-v4-flash',        'shoot', 'deepseek-v4-flash',        'DeepSeek V4 Flash',        0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/deepseek-v4-pro',          'shoot', 'deepseek-v4-pro',          'DeepSeek V4 Pro',          0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/glm-5-2-fast',             'shoot', 'glm-5-2-fast',             'GLM 5.2 Fast',             0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/glm-5-2',                  'shoot', 'glm-5-2',                  'GLM 5.2',                  0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- x3 (flagship)
  ('sh/claude-opus-4-6',          'shoot', 'claude-opus-4-6',          'Claude Opus 4.6',          0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/claude-opus-4-7',          'shoot', 'claude-opus-4-7',          'Claude Opus 4.7',          0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/claude-opus-4-8',          'shoot', 'claude-opus-4-8',          'Claude Opus 4.8',          0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('sh/gpt-5.5',                  'shoot', 'gpt-5.5',                  'GPT-5.5',                  0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb)
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
