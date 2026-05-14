-- ============================================================
-- TrollLLM (t/) Claude relaunch + per-user Claude activation gate.
--
-- 1. profiles.claude_activated — admin-managed flag analogous to
--    `is_activated`. Free users are blocked from Claude routes
--    (any provider) until an admin flips this TRUE. Paid users
--    (any plan != 'free') and anyone with a past purchase or paid
--    subscription history are grandfathered to TRUE on this
--    migration; the Stripe webhook flips it on future upgrades.
--
-- 2. trolllm Claude models are reactivated as premium-billed:
--      t/claude-opus-4.7    premium_request_cost = 6
--      t/claude-opus-4.6    premium_request_cost = 6
--      t/claude-sonnet-4.6  premium_request_cost = 3
--    All other t/ models stay deactivated (the GPT and Gemini
--    rows from migration 029 are no longer offered). Per-token
--    cost columns are restored to the original 029 values so
--    usage_logs still reflect upstream pricing.
--
--    Provider classification: t/ joins the premium-pool family
--    (webproxy/hapuppy/gameron/dlab/riftai/opencode) — handled in
--    src/lib/providers/types.ts.
-- ============================================================

-- 1. Per-user Claude gate.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS claude_activated BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.claude_activated IS
  'Claude-route gate: when false, requests for Claude models from this user are blocked. Free users start FALSE; paid users are auto-flipped TRUE on Stripe checkout. Admins can toggle from the panel.';

-- Grandfather paid users and anyone with prior purchase/subscription
-- history so existing customers aren't locked out retroactively.
UPDATE profiles
SET claude_activated = TRUE
WHERE plan_id <> 'free'
   OR id IN (
     SELECT DISTINCT user_id FROM subscriptions WHERE plan_id <> 'free'
   )
   OR id IN (
     SELECT DISTINCT user_id FROM transactions
     WHERE type = 'purchase' AND amount > 0
   );

-- 2. Deactivate every existing t/ row before reactivating only the
-- three Claude models we want offered. Idempotent.
UPDATE models
SET is_active = FALSE
WHERE provider = 'trolllm';

-- 3. Restore per-token pricing + set new premium_request_cost and
-- mark active for the three relaunched Claude models. ON CONFLICT
-- keeps the migration idempotent if rows were previously inserted
-- (they were, in 029 and 034).
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost
) VALUES
  ('t/claude-opus-4.7',   'trolllm', 'claude-opus-4.7',   'Claude Opus 4.7',   5, 25, 0.50, 6.25, 1.55, true, 6),
  ('t/claude-opus-4.6',   'trolllm', 'claude-opus-4.6',   'Claude Opus 4.6',   5, 25, 0.50, 6.25, 1.55, true, 6),
  ('t/claude-sonnet-4.6', 'trolllm', 'claude-sonnet-4.6', 'Claude Sonnet 4.6', 3, 15, 0.30, 3.75, 1.55, true, 3)
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
  premium_request_cost   = EXCLUDED.premium_request_cost;
