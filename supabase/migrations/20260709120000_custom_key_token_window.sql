-- Rolling token-window rate limit for custom keys.
--
-- Some custom keys need a "N tokens per rolling M-hour window" fair-use cap
-- (e.g. a shared key handed to a friend: 6M tokens / 5h). The existing custom
-- key knobs can't express this: premium providers (r/, sh/, ...) bill a flat
-- 1 credit PER REQUEST, so custom_credits is a request budget, not a token
-- budget; rate_limit_seconds only spaces requests; daily_request_limit is a
-- per-UTC-day request count. None of them bound *tokens* over a sliding window.
--
-- This adds a per-key token-window limit enforced from the chat route:
--   * pre-flight  -> check_custom_key_token_window() rejects (429) if the sum
--                    of tokens in the trailing window already meets the limit.
--   * settlement  -> record_custom_key_tokens() appends the request's real
--                    total_tokens and prunes rows that have aged out.
--
-- A DEDICATED table (not usage_logs) is used on purpose: usage_logs is the
-- hottest insert path and deliberately has no (api_key_id, created_at) index
-- (see migration 20260529 + the 2026-06-08 Disk-IO outage). Summing it per
-- request would scan every key's last-window rows. This table is written to
-- ONLY by keys that have a token window configured (a tiny minority), stays
-- small thanks to opportunistic pruning, and carries its own cheap index.

-- 1. Per-key config columns. NULL / 0 window_limit = feature off (default).
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS token_window_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS token_window_limit   BIGINT;

COMMENT ON COLUMN public.api_keys.token_window_seconds IS
  'Rolling window length in seconds for the per-key token cap (e.g. 18000 = 5h). NULL disables.';
COMMENT ON COLUMN public.api_keys.token_window_limit IS
  'Max total tokens allowed within token_window_seconds. NULL/0 disables the cap.';

-- 2. Append-only usage ledger for windowed keys.
CREATE TABLE IF NOT EXISTS public.custom_key_token_usage (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id     UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  tokens     INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_key_token_usage_key_created
  ON public.custom_key_token_usage (key_id, created_at DESC);

ALTER TABLE public.custom_key_token_usage ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (chat route admin client) touches it.

-- 3. Pre-flight check. Returns the current window usage and whether the next
--    request is allowed. Mirrors reserve_custom_key_request's jsonb contract.
CREATE OR REPLACE FUNCTION public.check_custom_key_token_window(
  p_key_id         UUID,
  p_window_seconds INTEGER,
  p_token_limit    BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now      TIMESTAMPTZ := now();
  v_cutoff   TIMESTAMPTZ;
  v_used     BIGINT;
  v_oldest   TIMESTAMPTZ;
  v_retry    INTEGER;
BEGIN
  IF COALESCE(p_token_limit, 0) <= 0 OR COALESCE(p_window_seconds, 0) <= 0 THEN
    RETURN jsonb_build_object('status', 'ok', 'used', 0);
  END IF;

  v_cutoff := v_now - make_interval(secs => p_window_seconds);

  SELECT COALESCE(SUM(tokens), 0), MIN(created_at)
    INTO v_used, v_oldest
    FROM public.custom_key_token_usage
   WHERE key_id = p_key_id
     AND created_at > v_cutoff;

  IF v_used >= p_token_limit THEN
    -- Retry once the oldest in-window request ages out of the window.
    v_retry := CEIL(EXTRACT(
      EPOCH FROM (v_oldest + make_interval(secs => p_window_seconds) - v_now)
    ))::INTEGER;
    RETURN jsonb_build_object(
      'status',              'limited',
      'used',                v_used,
      'limit',               p_token_limit,
      'retry_after_seconds', GREATEST(COALESCE(v_retry, 1), 1)
    );
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'used', v_used, 'limit', p_token_limit);
END;
$$;

-- 4. Post-settlement record + opportunistic prune (keeps the table tiny).
CREATE OR REPLACE FUNCTION public.record_custom_key_tokens(
  p_key_id         UUID,
  p_tokens         INTEGER,
  p_window_seconds INTEGER
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_tokens, 0) > 0 THEN
    INSERT INTO public.custom_key_token_usage (key_id, tokens)
    VALUES (p_key_id, p_tokens);
  END IF;

  -- Prune rows older than the window so the ledger never accumulates. A small
  -- grace multiple of the window is kept for auditability.
  IF COALESCE(p_window_seconds, 0) > 0 THEN
    DELETE FROM public.custom_key_token_usage
     WHERE key_id = p_key_id
       AND created_at < now() - make_interval(secs => p_window_seconds * 2);
  END IF;
END;
$$;

-- 5. Lock down execution to the service role only.
REVOKE EXECUTE ON FUNCTION public.check_custom_key_token_window(UUID, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_custom_key_token_window(UUID, INTEGER, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_custom_key_tokens(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_custom_key_tokens(UUID, INTEGER, INTEGER) TO service_role;
