-- ============================================================
-- Re-add Gameron (gm/) provider + standardize Claude Opus pricing
--
-- Gameron (api.gameron.me) fronts Anthropic's Claude family with
-- 1M-context variants. Returning it as a premium provider: flat
-- 1 credit per request + per-model premium_request_cost against
-- the daily premium pool (same billing shape as h/, t/, an/, w/).
--
-- Also standardizes premium_request_cost for ALL Claude Opus SKUs
-- (gm/ + h/) to 9 — the new unified opus tier cost. Sonnet and
-- Haiku keep their existing costs.
--
-- Supersedes migration 027 (remove_gameron_provider) which deleted
-- the original gm/ catalog; the key is valid again and the provider
-- now exposes 1M-context SKUs.
-- ============================================================

-- 1. Gameron catalog — 3 SKUs (Opus, Sonnet, Haiku).
-- cost_per_m_* columns mirror Anthropic 1M pricing for logging;
-- premium billing is flat-rate so only premium_request_cost matters
-- for the user's credit charge.
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('gm/claude-opus-4-6-1m',    'gameron', 'claude-opus-4-6-1m',    'Claude Opus 4.6 (1M)',    10.0000, 50.0000, 1.0000, 12.5000, 1.5500, true, 9.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('gm/claude-sonnet-4-6-1m',  'gameron', 'claude-sonnet-4-6-1m',  'Claude Sonnet 4.6 (1M)',   6.0000, 22.5000, 0.6000,  7.5000, 1.5500, true, 3.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('gm/claude-haiku-4-5',      'gameron', 'claude-haiku-4-5',      'Claude Haiku 4.5',         1.0000,  5.0000, 0.1000,  1.2500, 1.5500, true, 1.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb)
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

-- 2. Standardize premium_request_cost = 9 for every Claude Opus SKU
-- across gm/ and h/. Previously:
--   h/claude-opus-4-5-20251101: 8
--   h/claude-opus-4-6:          8
--   h/claude-opus-4-7:         10
-- Now all opus tiers charge 9 premium requests per call.
UPDATE models
SET premium_request_cost = 9
WHERE id LIKE 'h/claude-opus-%'
   OR id LIKE 'gm/claude-opus-%';
