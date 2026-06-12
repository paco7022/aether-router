-- ============================================================
-- Add DeepSeek V4 family to or/ (Orbit).
--
-- Four upstream models, all verified live on the Anthropic-native
-- endpoint (/api/provider/agy/v1/messages) on 2026-05-30:
--   deepseek-v4-flash, deepseek-v4-pro,
--   deepseek-v4-pro[1m], deepseek-v4-flash[1m]
-- (the "[1m]" variants are 1M-context editions).
--
-- These are reasoning models — upstream returns a `thinking` block
-- alongside the `text` block. src/lib/providers/orbit.ts only forwards
-- text blocks/text_delta in both the stream and non-stream paths, so
-- the chain-of-thought is filtered out and never leaks to the client.
--
-- Pricing: upstream cost here is effectively just the Cloudflare call
-- (DeepSeek is near-free on the flat Kiro subscription), so these are
-- priced at the cheapest premium tier — premium_request_cost = 0.10
-- (barely touches the daily premium pool). Note orbit is a premium
-- provider, so the user is still charged the flat 1 credit/request
-- regardless; premium_request_cost only governs the pool draw.
-- cost_per_m mirrors the normal or/ tier for display/accounting.
--
-- Public id is bracket-free for the 1M variants (some OpenAI clients
-- choke on `[` in model names); upstream_model_id keeps the exact
-- bracketed name Orbit expects. Opens to free users like the rest of
-- or/ (CLAUDE_PAID_ONLY_BYPASS not needed — DeepSeek isn't Claude,
-- so claude_activated gate doesn't apply), still gated by premium
-- pool + context cap.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('or/deepseek-v4-flash',      'orbit', 'deepseek-v4-flash',      'DeepSeek V4 Flash',           0.20, 0.20, 0.02, 0.25, 1.0, true, 0.1, '["streaming", "system_message"]'::jsonb),
  ('or/deepseek-v4-pro',        'orbit', 'deepseek-v4-pro',        'DeepSeek V4 Pro',             0.20, 0.20, 0.02, 0.25, 1.0, true, 0.1, '["streaming", "system_message"]'::jsonb),
  ('or/deepseek-v4-flash-1m',   'orbit', 'deepseek-v4-flash[1m]',  'DeepSeek V4 Flash (1M)',      0.20, 0.20, 0.02, 0.25, 1.0, true, 0.1, '["streaming", "system_message"]'::jsonb),
  ('or/deepseek-v4-pro-1m',     'orbit', 'deepseek-v4-pro[1m]',    'DeepSeek V4 Pro (1M)',        0.20, 0.20, 0.02, 0.25, 1.0, true, 0.1, '["streaming", "system_message"]'::jsonb)
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
