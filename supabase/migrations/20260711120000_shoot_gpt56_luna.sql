-- ============================================================
-- sh00t.host (sh/) — add GPT-5.6 Luna
--
-- New OpenAI model confirmed live in the sh/ upstream catalog
-- (GET https://sh00t.host/v1/models -> "gpt-5.6-luna") and verified
-- serving real completions 2026-07-11.
--
-- Premium-pool provider like the rest of sh/: flat 1 credit/request +
-- premium_request_cost against the daily pool, no per-token billing
-- (cost_per_m left at 0; the upstream inflates reported input tokens by
-- injecting its own system prompt, so per-token billing would be wrong).
--
-- Tier: x3 — same flagship multiplier as sh/gpt-5.5 and the Claude Opus
-- rows (owner convention 2026-07-08: GPT-5.x / Claude Opus = 3).
-- margin 1.5500 matches every other sh/ row.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('sh/gpt-5.6-luna', 'shoot', 'gpt-5.6-luna', 'GPT-5.6 Luna', 0, 0, 0, 0, 1.5500, true, 3.00, '["tool_calling", "streaming", "system_message"]'::jsonb)
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
