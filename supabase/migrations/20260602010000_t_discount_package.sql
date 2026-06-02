-- t/ half-price package: for 50k credits a user gets trolllm (t/) premium
-- requests at half cost (Opus 6→3, Sonnet 3→1.5) for 30 days. Stored as a
-- per-user expiry on profiles, mirroring context_boost_expires_at. Enforced at
-- charge time in /api/v1/chat/completions; purchased via /api/v1/billing/t-discount.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS t_discount_expires_at timestamptz;
