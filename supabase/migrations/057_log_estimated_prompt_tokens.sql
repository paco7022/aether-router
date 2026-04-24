-- ============================================================
-- 057_log_estimated_prompt_tokens
--
-- Adds `estimated_prompt_tokens` to usage_logs so we can compare
-- the app-side o200k pre-flight estimate to what upstream reports
-- as `prompt_tokens`. A systematic gap (e.g. upstream always 1.5-2x
-- our estimate on the same body) indicates upstream is inflating
-- token counts; a small gap means our estimator is within margin
-- and JanitorAI-style frontends are under-reporting their own
-- payload size to the user.
-- ============================================================

ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS estimated_prompt_tokens INTEGER;

COMMENT ON COLUMN public.usage_logs.estimated_prompt_tokens IS
  'o200k-based pre-flight estimate of prompt tokens. Populated at request time from estimatePromptTokens(body); compare against prompt_tokens (upstream-reported) to detect overcounting.';
