-- ============================================================
-- RiftAI (r/) provider — premium OpenAI-compatible reseller
--
-- Endpoint: https://riftai.su/v1/chat/completions. Fronts Anthropic,
-- OpenAI, Google, DeepSeek, Moonshot. Billed as a premium provider:
-- flat 1 credit per request + premium_request_cost against the daily
-- premium pool. Same shape as h/, gm/, t/, an/, w/, db/.
--
-- Unlike db/, no per-user approval gate. Claude models still require a
-- paid plan via the existing claude-block.ts CLAUDE_PAID_ONLY rule.
--
-- premium_request_cost per spec:
--   Opus (4-5/4-6/4-7)              = 12
--   Sonnet (4-5/4-6)                =  8
--   gpt-5.5-pro                     = 25
--   gemini-3-flash-preview          =  3
--   gemini-2.5-pro                  =  5
--   gemini-3.1-pro-preview          =  6
--   deepseek-v4-flash               =  1
--   deepseek-v4-pro                 =  2
--   kimi-k2.6                       =  2
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('r/claude-opus-4-7',           'riftai', 'claude-opus-4-7',           'Claude Opus 4.7',            15.0000, 75.0000, 1.5000, 18.7500, 1.5500, true, 15.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/claude-opus-4-6',           'riftai', 'claude-opus-4-6',           'Claude Opus 4.6',            15.0000, 75.0000, 1.5000, 18.7500, 1.5500, true, 15.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/claude-opus-4-5',           'riftai', 'claude-opus-4-5',           'Claude Opus 4.5',            15.0000, 75.0000, 1.5000, 18.7500, 1.5500, true, 15.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/claude-sonnet-4-6',         'riftai', 'claude-sonnet-4-6',         'Claude Sonnet 4.6',           3.0000, 15.0000, 0.3000,  3.7500, 1.5500, true,  8.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/claude-sonnet-4-5',         'riftai', 'claude-sonnet-4-5',         'Claude Sonnet 4.5',           3.0000, 15.0000, 0.3000,  3.7500, 1.5500, true,  8.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/gpt-5.5-pro',               'riftai', 'gpt-5.5-pro',               'GPT 5.5 Pro',                10.0000, 40.0000, 1.0000,  0.0000, 1.5500, true, 25.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode"]'::jsonb),
  ('r/gemini-3-flash-preview',    'riftai', 'gemini-3-flash-preview',    'Gemini 3 Flash (Preview)',    0.3000,  2.5000, 0.0750,  0.0000, 1.5500, true,  3.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/gemini-2.5-pro',            'riftai', 'gemini-2.5-pro',            'Gemini 2.5 Pro',              1.2500, 10.0000, 0.3100,  0.0000, 1.5500, true,  5.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/gemini-3.1-pro-preview',    'riftai', 'gemini-3.1-pro-preview',    'Gemini 3.1 Pro (Preview)',    2.0000,  8.0000, 0.2000,  2.0000, 1.5500, true,  6.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('r/deepseek-v4-flash',         'riftai', 'deepseek-v4-flash',         'DeepSeek V4 Flash',           0.2700,  1.1000, 0.0300,  0.0000, 1.5500, true,  1.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/deepseek-v4-pro',           'riftai', 'deepseek-v4-pro',           'DeepSeek V4 Pro',             0.5500,  2.2000, 0.0600,  0.0000, 1.5500, true,  2.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/kimi-k2.6',                 'riftai', 'kimi-k2.6',                 'Kimi K2.6',                   0.6000,  2.5000, 0.1500,  0.0000, 1.5500, true,  2.00, '["tool_calling", "streaming", "system_message"]'::jsonb)
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
