-- ============================================================
-- Add Claude Opus 4.8 across or/ (Orbit) and t/ (TrollLLM).
--
-- or/ (orbit): two rows. Both priced at the 2x "inflated" tier —
--   the -agentic variant ships Kiro's full IDE system prompt, and
--   the plain 4-8 is reasoning-heavy like 4-7 (which is also 2x).
--   0.40 / 1M tokens, 2 premium requests/call, margin 1.0.
--   Opens to free users like the rest of or/ (CLAUDE_PAID_ONLY_BYPASS),
--   still gated by profiles.claude_activated + premium pool + ctx cap.
--
-- t/ (trolllm): one row, premium-billed like the relaunched 4.7/4.6
--   (migration 075). premium_request_cost = 6, per-token cost mirrors
--   t/claude-opus-4.7. upstream_model_id uses the dashed form
--   (claude-opus-4-8) to match what TrollLLM accepts.
--
-- display_name never leaks the upstream provider (private).
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('or/claude-opus-4-8',         'orbit',   'claude-opus-4-8',         'Claude Opus 4.8',         0.40, 0.40, 0.04, 0.50, 1.0,  true, 2, '["streaming", "system_message"]'::jsonb),
  ('or/claude-opus-4-8-agentic', 'orbit',   'claude-opus-4-8-agentic', 'Claude Opus 4.8 Agentic', 0.40, 0.40, 0.04, 0.50, 1.0,  true, 2, '["streaming", "system_message"]'::jsonb),
  ('t/claude-opus-4-8',          'trolllm', 'claude-opus-4-8',         'Claude Opus 4.8',         5,    25,   0.50, 6.25, 1.55, true, 6, '["streaming", "system_message"]'::jsonb)
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
