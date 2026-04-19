-- ============================================================
-- 045_accrue_prompt_cap_debt
--
-- The pre-flight context estimator in the app can under-count for
-- markdown-heavy or CJK content, letting a prompt whose actual
-- prompt_tokens exceed the user's `plans.gm_max_context` pass the
-- check. After the upstream returns real usage, we bump
-- `profiles.premium_request_debt` so the next call to
-- `reserve_premium_request` counts the debt against the daily cap.
--
-- Debt rollover does NOT reset on day change — only
-- `premium_requests_today` does. Admin clears manually.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accrue_prompt_cap_debt(
  p_user_id         UUID,
  p_plan_id         TEXT,
  p_actual_tokens   INTEGER,
  p_penalty         NUMERIC DEFAULT 3
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cap        INTEGER;
  v_new_debt   NUMERIC;
BEGIN
  IF p_user_id IS NULL OR p_actual_tokens IS NULL OR p_actual_tokens <= 0 THEN
    RETURN 0;
  END IF;

  SELECT gm_max_context INTO v_cap
    FROM public.plans
   WHERE id = p_plan_id;

  -- gm_max_context = 0 means "unlimited" (Ultimate tier) — never accrue.
  IF v_cap IS NULL OR v_cap <= 0 OR p_actual_tokens <= v_cap THEN
    RETURN 0;
  END IF;

  UPDATE public.profiles
     SET premium_request_debt = COALESCE(premium_request_debt, 0) + COALESCE(p_penalty, 3),
         updated_at           = NOW()
   WHERE id = p_user_id
   RETURNING premium_request_debt INTO v_new_debt;

  RETURN COALESCE(v_new_debt, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accrue_prompt_cap_debt(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.accrue_prompt_cap_debt(UUID, TEXT, INTEGER, NUMERIC) TO service_role;
