-- ============================================================
-- Security & schema hardening
-- - Add missing columns referenced by runtime code
-- - Fix usage_logs FK to allow API key deletion
-- - Add webhook event cleanup policy
-- ============================================================

-- 1. Add upstream_model_id column (used by chat/completions to map
--    model IDs to upstream provider model names).
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS upstream_model_id TEXT;

-- 2. Add premium_request_cost column (flat-rate budget cost for
--    premium providers like trolllm, antigravity, webproxy).
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS premium_request_cost INTEGER NOT NULL DEFAULT 1;

-- 3. Fix usage_logs.api_key_id FK: allow key deletion without
--    orphaning historical usage records.  SET NULL keeps the log
--    row intact but clears the FK reference.
ALTER TABLE usage_logs
  ALTER COLUMN api_key_id DROP NOT NULL;

ALTER TABLE usage_logs
  DROP CONSTRAINT IF EXISTS usage_logs_api_key_id_fkey;

ALTER TABLE usage_logs
  ADD CONSTRAINT usage_logs_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;

-- 4. Add premium_cost column to usage_logs if missing (tracks per-request
--    premium budget consumed — used for daily premium limit enforcement).
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS premium_cost INTEGER NOT NULL DEFAULT 0;

-- 5. Cleanup policy: auto-delete Stripe webhook events older than 90 days.
-- Run via pg_cron or a scheduled edge function:
--   SELECT cleanup_old_webhook_events();
CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM stripe_webhook_events
  WHERE created_at < NOW() - INTERVAL '90 days'
  AND success = true;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION cleanup_old_webhook_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_webhook_events() TO service_role;
