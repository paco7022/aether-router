-- ============================================================
-- DLab (db/) provider — premium Claude reseller, gated by
-- per-user admin approval.
--
-- Endpoint: https://api.dlabkeys.com/v1/chat/completions (OpenAI-compatible).
-- Billed as a premium provider (flat 1 credit per request + premium-pool
-- charge), but with one extra constraint that no other premium provider
-- has: every user must be flipped on individually via
-- profiles.dlab_approved before they can route to db/ models. The cost
-- per request is so high that we don't want to leave the door open by
-- default.
--
-- premium_request_cost: Opus = 12, Sonnet = 6 (per spec). The flat
-- billing means cost_per_m_* columns are only used for usage logging,
-- not for credit deduction.
--
-- The gate is plan-independent: an approved free user can use it. This
-- is intentional so granting access to a specific user later doesn't
-- require any code change.
-- ============================================================

-- 1. Per-user approval flag.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dlab_approved BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.dlab_approved IS
  'Admin-managed gate: when true, this user can route requests to db/ models. Off by default; enabled per-user from the admin panel.';

-- 2. Catalog. cost_per_m_* mirror typical Anthropic pricing for logging
-- only — premium providers always charge a flat 1 credit per request.
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('db/claude-opus-4.7',   'dlab', 'claude-opus-4.7',   'Claude Opus 4.7',   15.0000, 75.0000, 1.5000, 18.7500, 1.5500, true, 12.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('db/claude-opus-4.6',   'dlab', 'claude-opus-4.6',   'Claude Opus 4.6',   15.0000, 75.0000, 1.5000, 18.7500, 1.5500, true, 12.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('db/claude-opus-4.5',   'dlab', 'claude-opus-4.5',   'Claude Opus 4.5',   15.0000, 75.0000, 1.5000, 18.7500, 1.5500, true, 12.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('db/claude-sonnet-4.6', 'dlab', 'claude-sonnet-4.6', 'Claude Sonnet 4.6',  3.0000, 15.0000, 0.3000,  3.7500, 1.5500, true,  6.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb),
  ('db/claude-sonnet-4.5', 'dlab', 'claude-sonnet-4.5', 'Claude Sonnet 4.5',  3.0000, 15.0000, 0.3000,  3.7500, 1.5500, true,  6.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb)
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
