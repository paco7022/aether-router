-- ============================================================
-- rout.my (rt/) provider — premium OpenAI-compatible reseller
--
-- Endpoint: https://api.rout.my/v1/chat/completions. Fronts DeepSeek,
-- Google Gemini, xAI Grok, MiniMax, Moonshot, NVIDIA Nemotron, Xiaomi
-- MiMo and z.ai GLM. Billed as a premium provider: flat 1 credit per
-- request + premium_request_cost against the daily premium pool.
-- Same shape as r/, h/, gm/, t/, an/, w/.
--
-- Per-token cost_per_m left at 0 on purpose: premium-pool providers
-- charge via premium_request_cost only, never per-token.
--
-- premium_request_cost = the x-multiplier from the provider's price list:
--   x0.5 → 0.50   x1 → 1.00   x2 → 2.00   x3 → 3.00   x4 → 4.00   x5 → 5.00
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  -- x0.5
  ('rt/deepseek/deepseek-v4-flash',      'routmy', 'deepseek/deepseek-v4-flash',      'DeepSeek V4 Flash',          0, 0, 0, 0, 1.5500, true, 0.50, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/nvidia/nemotron-3-ultra',         'routmy', 'nvidia/nemotron-3-ultra',         'Nemotron 3 Ultra',           0, 0, 0, 0, 1.5500, true, 0.50, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/x-ai/grok-4.1-fast',              'routmy', 'x-ai/grok-4.1-fast',              'Grok 4.1 Fast',              0, 0, 0, 0, 1.5500, true, 0.50, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- x1
  ('rt/deepseek/deepseek-v4-pro',        'routmy', 'deepseek/deepseek-v4-pro',        'DeepSeek V4 Pro',            0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/google/gemini-3.1-flash-lite',    'routmy', 'google/gemini-3.1-flash-lite',    'Gemini 3.1 Flash Lite',      0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('rt/minimax/minimax-m2.5',            'routmy', 'minimax/minimax-m2.5',            'MiniMax M2.5',               0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/minimax/minimax-m2.7',            'routmy', 'minimax/minimax-m2.7',            'MiniMax M2.7',               0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/nvidia/nemotron-3-ultra-limited', 'routmy', 'nvidia/nemotron-3-ultra-limited', 'Nemotron 3 Ultra (Limited)', 0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/xiaomi/mimo-v2.5-pro',            'routmy', 'xiaomi/mimo-v2.5-pro',            'MiMo V2.5 Pro',              0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/deepseek/deepseek-r1-0528',       'routmy', 'deepseek/deepseek-r1-0528',       'DeepSeek R1 (0528)',         0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/deepseek/deepseek-chat-v3.1',     'routmy', 'deepseek/deepseek-chat-v3.1',     'DeepSeek Chat V3.1',         0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/deepseek/deepseek-v3.1-terminus', 'routmy', 'deepseek/deepseek-v3.1-terminus', 'DeepSeek V3.1 Terminus',     0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/moonshotai/kimi-k2.5',            'routmy', 'moonshotai/kimi-k2.5',            'Kimi K2.5',                  0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/moonshotai/kimi-k2.6',            'routmy', 'moonshotai/kimi-k2.6',            'Kimi K2.6',                  0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- x2
  ('rt/z-ai/glm-4.6',                    'routmy', 'z-ai/glm-4.6',                    'GLM 4.6',                    0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/z-ai/glm-4.7',                    'routmy', 'z-ai/glm-4.7',                    'GLM 4.7',                    0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/z-ai/glm-5',                      'routmy', 'z-ai/glm-5',                      'GLM 5',                      0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/z-ai/glm-5.1',                    'routmy', 'z-ai/glm-5.1',                    'GLM 5.1',                    0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/x-ai/grok-4.20',                  'routmy', 'x-ai/grok-4.20',                  'Grok 4.20',                  0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('rt/x-ai/grok-4.3',                   'routmy', 'x-ai/grok-4.3',                   'Grok 4.3',                   0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  -- x3
  ('rt/google/gemini-3.5-flash',         'routmy', 'google/gemini-3.5-flash',         'Gemini 3.5 Flash',           0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  -- x4
  ('rt/google/gemini-2.5-pro',           'routmy', 'google/gemini-2.5-pro',           'Gemini 2.5 Pro',             0, 0, 0, 0, 1.5500, true, 4.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  -- x5
  ('rt/google/gemini-3.1-pro-preview',   'routmy', 'google/gemini-3.1-pro-preview',   'Gemini 3.1 Pro (Preview)',   0, 0, 0, 0, 1.5500, true, 5.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb)
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
