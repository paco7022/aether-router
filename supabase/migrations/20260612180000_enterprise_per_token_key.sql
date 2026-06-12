-- Enterprise per-token billing for custom API keys.
--
-- A custom key (is_custom=true) can bill a FLAT $/M-token rate against its
-- prepaid `custom_credits` pool, bypassing the premium-request pool and daily
-- caps entirely. Built for B2B contracts (e.g. 600M tokens/week of or/ at $3/M).
--
-- pricing_mode:
--   'standard'       — existing behavior (per-request premium pool, or per-token
--                      model pricing for standard providers).
--   'flat_per_token' — charge (prompt + completion) tokens × flat_cost_per_m_tokens
--                      (USD/1M), deducted from api_keys.custom_credits. The
--                      premium-request pool is NOT touched. is_custom must be true.
--
-- Billing math (see src/lib/credits.ts): credits = ceil(tokens/1M * rate * CREDITS_PER_USD).
-- With CREDITS_PER_USD=10000 and rate=3.00 → 30,000 credits per 1M tokens.
-- custom_credits is int4 (max ~2.1B credits ≈ 71.6B tokens) — ample for any
-- realistic prepay; a weekly 600M-token bucket is ~18M credits.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS flat_cost_per_m_tokens NUMERIC(10,4);

DO $$ BEGIN
  ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_pricing_mode_chk
    CHECK (pricing_mode IN ('standard', 'flat_per_token'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A flat_per_token key must carry a positive rate (guards against a misconfigured
-- key silently billing 0 and serving for free).
DO $$ BEGIN
  ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_flat_rate_chk
    CHECK (
      pricing_mode <> 'flat_per_token'
      OR (flat_cost_per_m_tokens IS NOT NULL AND flat_cost_per_m_tokens > 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN api_keys.pricing_mode IS 'standard | flat_per_token (enterprise per-token billing against prepaid custom_credits)';
COMMENT ON COLUMN api_keys.flat_cost_per_m_tokens IS 'USD per 1M tokens (prompt+completion) when pricing_mode=flat_per_token';
