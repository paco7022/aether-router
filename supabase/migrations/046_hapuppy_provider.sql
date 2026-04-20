-- ============================================================
-- Hapuppy (h/) provider — premium OpenAI-compatible reseller
--
-- Fronts Anthropic / Google / DeepSeek / Zhipu (GLM) / Moonshot (Kimi)
-- via https://beta.hapuppy.com/v1. Billed as a premium provider:
-- flat 1 credit per request + model-specific premium_request_cost
-- against the user's daily premium pool.
--
-- Token-based cost columns (cost_per_m_*) mirror typical upstream
-- pricing but are only used for logging — premium providers always
-- charge a flat 1 credit per request.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('h/claude-opus-4-6',            'hapuppy', 'claude-opus-4-6',            'Claude Opus 4.6',              5.0000, 25.0000, 0.5000, 6.2500, 1.5500, true, 6.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/claude-opus-4-5-20251101',   'hapuppy', 'claude-opus-4-5-20251101',   'Claude Opus 4.5 (20251101)',   5.0000, 25.0000, 0.5000, 6.2500, 1.5500, true, 6.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/claude-opus-4-7',            'hapuppy', 'claude-opus-4-7',            'Claude Opus 4.7',              5.0000, 25.0000, 0.5000, 6.2500, 1.5500, true, 8.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/claude-sonnet-4-5',          'hapuppy', 'claude-sonnet-4-5',          'Claude Sonnet 4.5',            3.0000, 15.0000, 0.3000, 3.7500, 1.5500, true, 1.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/claude-sonnet-4-5-20250929', 'hapuppy', 'claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5 (20250929)', 3.0000, 15.0000, 0.3000, 3.7500, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/claude-sonnet-4-6',          'hapuppy', 'claude-sonnet-4-6',          'Claude Sonnet 4.6',            3.0000, 15.0000, 0.3000, 3.7500, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/deepseek-v3.2',              'hapuppy', 'deepseek-v3.2',              'DeepSeek V3.2',                0.2700, 1.1000, 0.0300, 0.0000, 1.5500, true, 0.50, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('h/gemini-2.5-pro',             'hapuppy', 'gemini-2.5-pro',             'Gemini 2.5 Pro',               1.2500, 10.0000, 0.3100, 0.0000, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/gemini-3-flash-preview',     'hapuppy', 'gemini-3-flash-preview',     'Gemini 3 Flash (Preview)',     0.3000, 2.5000, 0.0750, 0.0000, 1.5500, true, 0.50, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/gemini-3.1-pro-preview',     'hapuppy', 'gemini-3.1-pro-preview',     'Gemini 3.1 Pro (Preview)',     2.0000, 8.0000, 0.2000, 2.0000, 1.5500, true, 2.50, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('h/glm-4.7',                    'hapuppy', 'glm-4.7',                    'GLM 4.7',                      0.6000, 2.2000, 0.1100, 0.0000, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('h/glm-5',                      'hapuppy', 'glm-5',                      'GLM 5',                        0.6000, 2.2000, 0.1100, 0.0000, 1.5500, true, 1.50, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('h/glm-5.1',                    'hapuppy', 'glm-5.1',                    'GLM 5.1',                      0.6000, 2.2000, 0.1100, 0.0000, 1.5500, true, 1.50, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('h/kimi-k2.5',                  'hapuppy', 'kimi-k2.5',                  'Kimi K2.5',                    0.6000, 2.5000, 0.1500, 0.0000, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb)
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
