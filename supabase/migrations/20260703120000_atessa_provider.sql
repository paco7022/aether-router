-- ============================================================
-- Atessa (at/) provider — premium reseller (official Claude Code harness)
--
-- Endpoint: https://atessa.top/v1/chat/completions. Fronts real Anthropic
-- Claude (Opus 4.6-4.8, Sonnet 4.6, Haiku 4.5, Fable 5) + OpenAI GPT-5.x +
-- Chinese models. Billed premium-pool (flat 1 credit + premium_request_cost).
-- Per-token cost_per_m stays 0 (display only).
--
-- Verified 2026-07-03: at/claude-opus-4-6 is REAL Claude. The owner confirms it
-- is the OFFICIAL Claude Code harness — the ~1.4k-token system prompt is Claude
-- Code's own, so the caller's `system` message is subordinated/ignored (breaks
-- presets). See memory project_aether_atessa.
--
-- ACTIVATION 2026-07-03: only the Claude models are is_active=true (public API
-- request). GPT/Chinese rows inserted inactive (is_active=false) — flip later if
-- wanted. Google/Composer/image models excluded entirely.
--
-- premium_request_cost = x-multiplier: Opus x7, Sonnet x3, Haiku x2,
-- Fable x100 (stored 99.99 — column is NUMERIC(4,2), 100 overflows), GPT x6,
-- Chinese x3.
--
-- KEY: ATESSA_API_KEY (isolated). WAF blocks non-browser UA (403) — the adapter
-- sends a browser UA. See src/lib/providers/atessa.ts.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  -- Claude — ACTIVE
  ('at/claude-opus-4-6', 'atessa', 'claude-opus-4-6', 'Claude Opus 4.6', 0, 0, 0, 0, 1.5500, true, 7.00,   '["streaming", "system_message"]'::jsonb),
  ('at/claude-opus-4-7', 'atessa', 'claude-opus-4-7', 'Claude Opus 4.7', 0, 0, 0, 0, 1.5500, true, 7.00,   '["streaming", "system_message"]'::jsonb),
  ('at/claude-opus-4-8', 'atessa', 'claude-opus-4-8', 'Claude Opus 4.8', 0, 0, 0, 0, 1.5500, true, 7.00,   '["streaming", "system_message"]'::jsonb),
  ('at/claude-sonnet-4-6', 'atessa', 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 0, 0, 0, 0, 1.5500, true, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/claude-haiku-4-5', 'atessa', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 0, 0, 0, 0, 1.5500, true, 2.00, '["streaming", "system_message"]'::jsonb),
  ('at/claude-fable-5', 'atessa', 'claude-fable-5', 'Claude Fable 5', 0, 0, 0, 0, 1.5500, true, 99.99, '["streaming", "system_message"]'::jsonb),
  -- OpenAI GPT-5.x — INACTIVE (x6)
  ('at/gpt-5.4',      'atessa', 'gpt-5.4',      'GPT 5.4',      0, 0, 0, 0, 1.5500, false, 6.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb),
  ('at/gpt-5.4-mini', 'atessa', 'gpt-5.4-mini', 'GPT 5.4 Mini', 0, 0, 0, 0, 1.5500, false, 6.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb),
  ('at/gpt-5.5',      'atessa', 'gpt-5.5',      'GPT 5.5',      0, 0, 0, 0, 1.5500, false, 6.00, '["tool_calling", "vision", "streaming", "system_message", "json_mode", "pdf_input"]'::jsonb),
  -- Chinese — INACTIVE (x3)
  ('at/deepseek-v4-flash', 'atessa', 'deepseek-v4-flash', 'DeepSeek V4 Flash', 0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/deepseek-v4-pro',   'atessa', 'deepseek-v4-pro',   'DeepSeek V4 Pro',   0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/glm-5.1', 'atessa', 'glm-5.1', 'GLM 5.1', 0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/glm-5.2', 'atessa', 'glm-5.2', 'GLM 5.2', 0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/kimi-k2.6',                'atessa', 'kimi-k2.6',                'Kimi K2.6',                0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/kimi-k2.7-code',           'atessa', 'kimi-k2.7-code',           'Kimi K2.7 Code',           0, 0, 0, 0, 1.5500, false, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('at/kimi-k2.7-code-highspeed', 'atessa', 'kimi-k2.7-code-highspeed', 'Kimi K2.7 Code Highspeed', 0, 0, 0, 0, 1.5500, false, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('at/minimax-m2.7', 'atessa', 'minimax-m2.7', 'Minimax M2.7', 0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb),
  ('at/minimax-m3',   'atessa', 'minimax-m3',   'Minimax M3',   0, 0, 0, 0, 1.5500, false, 3.00, '["streaming", "system_message"]'::jsonb)
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
