-- ============================================================
-- Pay-as-you-go billing mode (per-account toggle)
--
-- Premium providers bill a flat 1 credit/request + premium_request_cost against
-- the daily premium pool, and are context-capped. This adds an opt-in per-token
-- alternative: the user flips their account to 'payg' and premium models are
-- billed per token instead — no premium pool draw, no context cap, but more
-- expensive per request.
--
-- 1) profiles.billing_mode — the toggle. 'request' (default, current behaviour)
--    or 'payg'. Per account, not per key: one button in the dashboard.
--
-- 2) models.payg_credits_per_m_input / _output — the PAYG price, stored as
--    CREDITS PER 1M TOKENS directly (not USD).
--
--    Deliberately NOT reusing cost_per_m_input/output: those mean "our upstream
--    cost" and feed the logged costUsd + margin math. PAYG prices are a SELLING
--    price with the margin already baked in, so conflating them would corrupt
--    cost analytics and force a margin=1.0 hack. Separate columns keep both
--    meanings honest and make the number here the literal credits charged.
--
-- Tiers (owner-set 2026-07-14):
--   Claude Opus + GPT  → 2000 in / 30000 out
--   Claude Sonnet      →  800 in / 12000 out
--   Gemini             →  500 in /  4000 out
--   Everything else    →  300 in /  2000 out   (GLM, Kimi, Grok, MiniMax,
--                         Qwen, DeepSeek-via-reseller, Haiku, mimo, nemotron)
--
-- Applied to PREMIUM providers only. nano (na/) and deepseek (ds/) are excluded
-- on purpose: they are genuine per-token upstreams whose cost_per_m holds a REAL
-- cost and which already bill per token. Pricing them off this table would sell
-- below cost (e.g. ds/deepseek-v4-pro costs $0.435/M in; the 'else' tier would
-- charge 300 credits = $0.03/M).
--
-- Both changes are INERT until the route reads them: premium settlement
-- short-circuits at `isPremiumModel ? 1` before any per-token math.
-- ============================================================

-- 1) Per-account billing mode toggle
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'request';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_billing_mode_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_billing_mode_check
      CHECK (billing_mode IN ('request', 'payg'));
  END IF;
END $$;

COMMENT ON COLUMN profiles.billing_mode IS
  'request = flat 1 credit + premium pool draw + context cap (default). payg = per-token billing on premium models, no pool draw, no context cap.';

-- 2) PAYG price columns (credits per 1M tokens; 0 = not available for PAYG)
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS payg_credits_per_m_input  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payg_credits_per_m_output numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN models.payg_credits_per_m_input IS
  'Pay-as-you-go price: credits charged per 1M INPUT tokens (billed on our own token count, never the upstream usage). 0 = model not offered on PAYG.';
COMMENT ON COLUMN models.payg_credits_per_m_output IS
  'Pay-as-you-go price: credits charged per 1M OUTPUT tokens. 0 = model not offered on PAYG.';

-- 3) Seed the tiers across premium providers (na/ + ds/ deliberately excluded)
UPDATE models SET
  payg_credits_per_m_input = CASE
    WHEN id ILIKE '%opus%' OR id ILIKE '%gpt%' THEN 2000
    WHEN id ILIKE '%sonnet%'                   THEN  800
    WHEN id ILIKE '%gemini%'                   THEN  500
    ELSE                                             300
  END,
  payg_credits_per_m_output = CASE
    WHEN id ILIKE '%opus%' OR id ILIKE '%gpt%' THEN 30000
    WHEN id ILIKE '%sonnet%'                   THEN 12000
    WHEN id ILIKE '%gemini%'                   THEN  4000
    ELSE                                              2000
  END
WHERE provider IN (
  'webproxy', 'hapuppy', 'gameron', 'dlab', 'riftai', 'opencode', 'trolllm',
  'orbit', 'routmy', 'zenllm', 'kiro', 'atessa', 'googleai', 'shoot', 'blaze'
);
