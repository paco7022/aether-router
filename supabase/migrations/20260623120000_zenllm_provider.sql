-- ============================================================
-- ZenLLM (z/) provider — premium OpenAI-compatible reseller
--
-- Endpoint: https://api.zenllm.org/v1/chat/completions. Fronts Anthropic
-- Claude (Opus 4.5–4.8, Sonnet 4.5–4.6). Same shape as r/, t/, or/.
--
-- LAUNCH (2026-06-23): launched as a FREE promo for everyone via the
-- ZENLLM_FREE_UNLIMITED flag (default ON) in the chat route — paid plans get
-- UNLIMITED context, free plans get 32k. While the flag is on these rows route
-- as zero-cost (no credits / premium pool / daily cap), so the prices below
-- DO NOT apply yet.
--
-- The premium_request_cost values below are PLACEHOLDERS for the post-promo
-- price (mirrors t/: Opus = 6, Sonnet = 3). When the promo ends, flip
-- ZENLLM_FREE_UNLIMITED=false and these take effect — adjust them first to the
-- agreed price. cost_per_m_* are real Anthropic list prices (display only;
-- premium-pool billing charges via premium_request_cost, not per-token).
--
-- KEY: ZENLLM_API_KEY is an ENTERPRISE key SHARED with another router — kept
-- isolated in its own env var, never folded into a shared pool.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  -- Opus (placeholder post-promo cost = 6)
  ('z/claude-opus-4.5',   'zenllm', 'anthropic/claude-opus-4.5',   'Claude Opus 4.5',   5, 25, 0.50, 6.25, 1.55, true, 6, '["streaming", "system_message"]'::jsonb),
  ('z/claude-opus-4.6',   'zenllm', 'anthropic/claude-opus-4.6',   'Claude Opus 4.6',   5, 25, 0.50, 6.25, 1.55, true, 6, '["streaming", "system_message"]'::jsonb),
  ('z/claude-opus-4.7',   'zenllm', 'anthropic/claude-opus-4.7',   'Claude Opus 4.7',   5, 25, 0.50, 6.25, 1.55, true, 6, '["streaming", "system_message"]'::jsonb),
  ('z/claude-opus-4.8',   'zenllm', 'anthropic/claude-opus-4.8',   'Claude Opus 4.8',   5, 25, 0.50, 6.25, 1.55, true, 6, '["streaming", "system_message"]'::jsonb),
  -- Sonnet (placeholder post-promo cost = 3)
  ('z/claude-sonnet-4.5', 'zenllm', 'anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5', 3, 15, 0.30, 3.75, 1.55, true, 3, '["streaming", "system_message"]'::jsonb),
  ('z/claude-sonnet-4.6', 'zenllm', 'anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6', 3, 15, 0.30, 3.75, 1.55, true, 3, '["streaming", "system_message"]'::jsonb)
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
