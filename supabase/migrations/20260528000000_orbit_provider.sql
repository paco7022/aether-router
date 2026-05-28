-- ============================================================
-- Orbit (or/) provider — premium reseller fronting Amazon Kiro Pro.
--
-- Endpoint: https://api.orbit-provider.com/api/provider/agy/v1/messages
-- (Anthropic-native; the OpenAI-compat /v1 endpoint strips `<` tokens
-- from responses and is unsafe for code outputs — see
-- src/lib/providers/orbit.ts header). Auth via x-api-key + anthropic-version.
--
-- Billed as a premium provider: flat 1 credit per request +
-- premium_request_cost against the daily premium pool. Same shape as
-- t/, db/, h/, gm/, r/, w/.
--
-- Pricing model: upstream is a flat-rate Kiro subscription costing
-- ~$0.20 per million tokens averaged. Models that inflate tokens
-- (Opus 4.7, -thinking, every "-agentic" variant — they ship the
-- full Kiro IDE system prompt, ~3-5k extra input tokens per call)
-- are priced at 2x to compensate: 0.40 / 1M tokens and 2 premium
-- requests/call. Normal models: 0.20 / 1M and 1 request/call.
-- margin=1.0 since the per-token cost above already reflects upstream.
--
-- Claude access for or/: opens to free users (unlike db/, r/, gm/,
-- w/, h/). The paid-plan-only rule is bypassed via
-- CLAUDE_PAID_ONLY_BYPASS in src/lib/claude-block.ts; the per-user
-- profiles.claude_activated gate still applies, plus the standard
-- premium-pool + context-cap enforcement.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  -- Normal (1x): per-call upstream cost ≈ $0.20 / 1M tokens, 1 premium request
  ('or/claude-sonnet-4-5',           'orbit', 'claude-sonnet-4-5',           'Claude Sonnet 4.5',           0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),
  ('or/claude-sonnet-4-6',           'orbit', 'claude-sonnet-4-6',           'Claude Sonnet 4.6',           0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),
  ('or/claude-opus-4-5',             'orbit', 'claude-opus-4-5',             'Claude Opus 4.5',             0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),
  ('or/claude-opus-4-6',             'orbit', 'claude-opus-4-6',             'Claude Opus 4.6',             0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),
  ('or/deepseek-3-2',                'orbit', 'deepseek-3-2',                'DeepSeek 3.2',                0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),
  ('or/glm-5',                       'orbit', 'glm-5',                       'GLM 5',                       0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),
  ('or/minimax-m2-5',                'orbit', 'minimax-m2-5',                'Minimax M2.5',                0.20, 0.20, 0.02, 0.25, 1.0, true, 1, '["streaming", "system_message"]'::jsonb),

  -- Inflated (2x): -agentic variants ship Kiro's full IDE system prompt;
  -- Opus 4.7 and 4.6-thinking burn extra completion tokens via extended
  -- reasoning. 2 premium requests/call + 0.40 / 1M for accounting.
  ('or/claude-sonnet-4-5-agentic',   'orbit', 'claude-sonnet-4-5-agentic',   'Claude Sonnet 4.5 Agentic',   0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/claude-sonnet-4-6-agentic',   'orbit', 'claude-sonnet-4-6-agentic',   'Claude Sonnet 4.6 Agentic',   0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/claude-opus-4-7',             'orbit', 'claude-opus-4-7',             'Claude Opus 4.7',             0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/claude-opus-4-7-agentic',     'orbit', 'claude-opus-4-7-agentic',     'Claude Opus 4.7 Agentic',     0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/claude-opus-4-6-thinking',    'orbit', 'claude-opus-4-6-thinking',    'Claude Opus 4.6 Thinking',    0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/glm-5-agentic',               'orbit', 'glm-5-agentic',               'GLM 5 Agentic',               0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/minimax-m2-5-agentic',        'orbit', 'minimax-m2-5-agentic',        'Minimax M2.5 Agentic',        0.40, 0.40, 0.04, 0.50, 1.0, true, 2, '["streaming", "system_message"]'::jsonb)
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
