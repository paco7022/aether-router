-- ============================================================
-- 056_scale_prompt_cap_debt_penalty
--
-- The pre-flight context estimator in the app uses o200k_base which
-- under-counts markdown-heavy / CJK / roleplay payloads by up to
-- ~40%, letting prompts sneak past `plans.gm_max_context`. The
-- post-flight penalty in `accrue_prompt_cap_debt` was a flat 3 per
-- occurrence regardless of how far over the cap the prompt was, so
-- a 55k prompt on a 32k-cap plan cost the same as a 33k prompt.
--
-- Scale the penalty linearly with overage so that large undercounts
-- eat proportionally more of the daily premium cap. Every additional
-- 25% of `gm_max_context` worth of overage adds 1 to the base
-- penalty (floor 3):
--   - actual <=  cap            → penalty 0   (no debt)
--   - actual = cap * 1.03       → penalty 4
--   - actual = cap * 1.25       → penalty 4
--   - actual = cap * 1.50       → penalty 5
--   - actual = cap * 1.71       → penalty 6  (pacowwr case: 55k/32k)
--   - actual = cap * 2.00       → penalty 7
--   - actual = cap * 2.50       → penalty 9
--   - actual = cap * 3.00       → penalty 11
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
  v_base       NUMERIC;
  v_penalty    NUMERIC;
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

  v_base := COALESCE(p_penalty, 3);
  -- +1 penalty for every 25% of `v_cap` worth of overage. Keeps the
  -- minimum at `v_base` for tiny overages (where the estimator was
  -- only slightly off) and escalates for gross undercounts.
  v_penalty := v_base + CEIL((p_actual_tokens - v_cap)::NUMERIC / (v_cap * 0.25));

  UPDATE public.profiles
     SET premium_request_debt = COALESCE(premium_request_debt, 0) + v_penalty,
         updated_at           = NOW()
   WHERE id = p_user_id
   RETURNING premium_request_debt INTO v_new_debt;

  RETURN COALESCE(v_new_debt, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accrue_prompt_cap_debt(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.accrue_prompt_cap_debt(UUID, TEXT, INTEGER, NUMERIC) TO service_role;
