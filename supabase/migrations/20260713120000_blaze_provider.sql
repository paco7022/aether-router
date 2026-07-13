-- ============================================================
-- blazeapi.org (bl/) provider — premium OpenAI-compatible reseller
--
-- Endpoint: https://api.blazeapi.org/paid/v1/chat/completions. Fronts a mixed
-- catalog of real Anthropic Claude (Opus 4.5–4.8 + Sonnet 4.6/5, incl.
-- "-thinking" reasoning variants), Google Gemini 3.1 Pro, and z.ai GLM-5.2.
-- Same shape as sh/, z/, t/, or/, rt/. Billed as a premium provider:
-- flat 1 credit per request + premium_request_cost against the daily
-- premium pool.
--
-- Per-token cost_per_m left at 0 on purpose: premium-pool providers charge
-- via premium_request_cost only, never per-token. (The upstream also inflates
-- reported input tokens heavily on Claude by injecting its own system prompt,
-- so per-token billing would be wrong anyway.)
--
-- premium_request_cost = the x-multiplier tier. Launched 2026-07-13 at 1.00
-- across the board while the owner verified the models were real, then repriced
-- the same day to the standard tiers:
--   Claude Opus (incl. -thinking) → 6
--   Claude Sonnet 4.6 / 5         → 3
--   Gemini 3.1 Pro                → 3
--   GLM 5.2                       → 2
--
-- "-thinking" variants stream reasoning in a separate reasoning_content field
-- (the dashboard already renders it) → tagged with the `reasoning` capability.
--
-- KEY: BLAZE_API_KEY is kept isolated in its own env var, never folded into a
-- shared pool. upstream_model_id is the exact id returned by /paid/v1/models.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, context_length, capabilities
) VALUES
  -- Claude Opus (thinking variants carry the `reasoning` capability)
  ('bl/claude-opus-4.5-thinking', 'blaze', 'claude-opus-4.5-thinking', 'Claude Opus 4.5 (Thinking)', 0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message", "reasoning"]'::jsonb),
  ('bl/claude-opus-4.6',          'blaze', 'claude-opus-4.6',          'Claude Opus 4.6',           0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('bl/claude-opus-4.6-thinking', 'blaze', 'claude-opus-4.6-thinking', 'Claude Opus 4.6 (Thinking)', 0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message", "reasoning"]'::jsonb),
  ('bl/claude-opus-4.7',          'blaze', 'claude-opus-4.7',          'Claude Opus 4.7',           0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('bl/claude-opus-4.7-thinking', 'blaze', 'claude-opus-4.7-thinking', 'Claude Opus 4.7 (Thinking)', 0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message", "reasoning"]'::jsonb),
  ('bl/claude-opus-4.8',          'blaze', 'claude-opus-4.8',          'Claude Opus 4.8',           0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('bl/claude-opus-4.8-thinking', 'blaze', 'claude-opus-4.8-thinking', 'Claude Opus 4.8 (Thinking)', 0, 0, 0, 0, 1.5500, true, 6.00, 128000, '["tool_calling", "streaming", "system_message", "reasoning"]'::jsonb),
  -- Claude Sonnet
  ('bl/claude-sonnet-4.6',        'blaze', 'claude-sonnet-4.6',        'Claude Sonnet 4.6',         0, 0, 0, 0, 1.5500, true, 3.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('bl/claude-sonnet-5',          'blaze', 'claude-sonnet-5',          'Claude Sonnet 5',           0, 0, 0, 0, 1.5500, true, 3.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- Google Gemini
  ('bl/gemini-3.1-pro-preview',   'blaze', 'gemini-3.1-pro-preview',   'Gemini 3.1 Pro (Preview)',  0, 0, 0, 0, 1.5500, true, 3.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- z.ai GLM
  ('bl/glm-5.2',                  'blaze', 'glm-5.2',                  'GLM 5.2',                   0, 0, 0, 0, 1.5500, true, 2.00, 128000, '["tool_calling", "streaming", "system_message"]'::jsonb)
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
