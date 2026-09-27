-- ============================================================
-- Anthropic direct (ad/) — the REAL official api.anthropic.com, called with
-- our own personal API key (ANTHROPIC_DIRECT_API_KEY, .env.local only —
-- never in this repo, which is public).
--
-- NOT a reseller, not open to the plan-based Claude gate: this provider is
-- deliberately left OUT of ALLOWED_CLAUDE_PROVIDERS /
-- CLAUDE_PAID_ONLY_BYPASS / CLAUDE_ACTIVATION_BYPASS in claude-block.ts. The
-- normal paid-plan + claude_activated rule must never grant access. The only
-- door in is a hand-minted custom key whose allowed_providers explicitly
-- lists "anthropic" — see isAnthropicDirectAllowed() in claude-block.ts and
-- the special case in chat/completions/route.ts. Verified live against
-- GET /v1/models on 2026-09-26 with the real key.
--
-- Billed as a premium provider, same tiering convention as k/ (kiro):
-- opus-tier = 6 premium_request/call, sonnet = 3, haiku = 1. In practice this
-- never gets charged — the only keys that can reach "anthropic" are unlimited
-- custom keys (custom_credits = null) — the tier is just a sane default in
-- case a limited-credit custom key ever gets pointed here.
--
-- cost_per_m_* mirror Anthropic's real published list prices (informational —
-- usage_logs accounting only, not billed to the custom key). claude-opus-5-5
-- has no confirmed published price yet (released 2026-09-21); priced the same
-- as claude-opus-5 as a placeholder — adjust if Anthropic publishes a
-- different rate.
--
-- capabilities intentionally omit "tool_calling" and "vision": v1 of
-- src/lib/providers/anthropic.ts (same limitation as orbit.ts) translates
-- text only — no tool-call or image content translation yet. Text chat /
-- roleplay only, not (yet) suitable for Claude Code or other tool-using
-- clients.
--
-- ad/claude-fable-5-1 is inserted is_active=false on purpose: at $10/$50 per
-- million tokens it's too expensive to hand out even on this personal/
-- friend-only provider — nobody gets access. Kept in the table (not deleted)
-- so it's a one-flag flip if that changes later.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, context_length, capabilities
) VALUES
  ('ad/claude-opus-5-5',   'anthropic', 'claude-opus-5-5',            'Claude Opus 5.5',   5,  25, 0.5, 0, 1.0, true,  6, 1000000, '["streaming","system_message","reasoning","pdf_input"]'::jsonb),
  ('ad/claude-fable-5-1',  'anthropic', 'claude-fable-5-1',           'Claude Fable 5.1',  10, 50, 1.0, 0, 1.0, false, 6, 1000000, '["streaming","system_message","reasoning","pdf_input"]'::jsonb),
  ('ad/claude-opus-5',     'anthropic', 'claude-opus-5',              'Claude Opus 5',     5,  25, 0.5, 0, 1.0, true,  6, 1000000, '["streaming","system_message","reasoning","pdf_input"]'::jsonb),
  ('ad/claude-sonnet-5',   'anthropic', 'claude-sonnet-5',            'Claude Sonnet 5',   2,  10, 0.2, 0, 1.0, true, 3, 1000000, '["streaming","system_message","reasoning","pdf_input"]'::jsonb),
  ('ad/claude-haiku-4-5',  'anthropic', 'claude-haiku-4-5-20251001',  'Claude Haiku 4.5',  1,  5,  0.1, 0, 1.0, true, 1,  200000, '["streaming","system_message","pdf_input"]'::jsonb)
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
  context_length         = EXCLUDED.context_length,
  capabilities           = EXCLUDED.capabilities;
