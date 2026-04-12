-- ============================================================
-- Critical hardening
-- - Align schema with runtime fields used by API/admin routes
-- - Restrict user-writable columns on profiles/api_keys
-- - Add atomic custom-key credit mutation RPCs
-- - Add Stripe webhook idempotency table
-- ============================================================

-- ------------------------------------------------------------------
-- 1) Schema alignment for fields already used in runtime code.
-- ------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gm_daily_override INTEGER,
  ADD COLUMN IF NOT EXISTS gm_override_expires TIMESTAMPTZ;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS custom_credits BIGINT,
  ADD COLUMN IF NOT EXISTS max_context INTEGER,
  ADD COLUMN IF NOT EXISTS allowed_providers TEXT[],
  ADD COLUMN IF NOT EXISTS daily_request_limit INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- ------------------------------------------------------------------
-- 2) Restrict user writes to safe columns only.
--    Service role keeps full write access.
-- ------------------------------------------------------------------
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, updated_at) ON TABLE public.profiles TO authenticated;
GRANT UPDATE ON TABLE public.profiles TO service_role;

REVOKE INSERT ON TABLE public.api_keys FROM anon, authenticated;
GRANT INSERT (user_id, key_hash, key_prefix, name, is_active) ON TABLE public.api_keys TO authenticated;
GRANT INSERT ON TABLE public.api_keys TO service_role;

REVOKE UPDATE ON TABLE public.api_keys FROM anon, authenticated;
GRANT UPDATE (name, is_active, last_used) ON TABLE public.api_keys TO authenticated;
GRANT UPDATE ON TABLE public.api_keys TO service_role;

-- ------------------------------------------------------------------
-- 3) Atomic custom-key credit mutation helpers.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_custom_key_credits(
  p_key_id UUID,
  p_amount BIGINT
)
RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN -1;
  END IF;

  UPDATE public.api_keys
  SET custom_credits = custom_credits - p_amount
  WHERE id = p_key_id
    AND is_custom = TRUE
    AND custom_credits IS NOT NULL
    AND custom_credits >= p_amount
  RETURNING custom_credits INTO new_balance;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.add_custom_key_credits(
  p_key_id UUID,
  p_amount BIGINT
)
RETURNS BIGINT AS $$
DECLARE
  new_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN -1;
  END IF;

  UPDATE public.api_keys
  SET custom_credits = COALESCE(custom_credits, 0) + p_amount
  WHERE id = p_key_id
    AND is_custom = TRUE
  RETURNING custom_credits INTO new_balance;

  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.deduct_custom_key_credits(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_custom_key_credits(UUID, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.add_custom_key_credits(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_custom_key_credits(UUID, BIGINT) TO service_role;

-- ------------------------------------------------------------------
-- 4) Stripe webhook idempotency tracking.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created
  ON public.stripe_webhook_events (created_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON public.stripe_webhook_events;
CREATE POLICY "service_role_only" ON public.stripe_webhook_events
  FOR ALL USING (auth.role() = 'service_role');
