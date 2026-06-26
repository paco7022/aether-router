-- ============================================================
-- Training program: staged dataset-size checkpoints (in-DB alerts)
-- ============================================================
-- Three training-quality experiments at 50M / 100M / 200M CLEAN tokens. The
-- program stays active (daily credits keep flowing) until the final 200M; the
-- 50M and 100M points are NON-blocking alerts — record_training_sample stamps
-- reached_at the moment captured_tokens crosses each threshold, so we know when
-- to kick off each run. Same 8-arg RPC signature → no app redeploy needed.
-- ============================================================

UPDATE public.training_program SET token_goal = 200000000, updated_at = now() WHERE id = 1;

CREATE TABLE IF NOT EXISTS public.training_milestones (
  threshold    BIGINT PRIMARY KEY,
  label        TEXT NOT NULL,
  reached      BOOLEAN NOT NULL DEFAULT false,
  reached_at   TIMESTAMPTZ,
  -- Stamped by scripts/auto-train-runner.mjs once it has exported the dataset
  -- for this milestone, so the scheduled task processes each one exactly once.
  processed_at TIMESTAMPTZ
);
ALTER TABLE public.training_milestones ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.training_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_milestones FROM anon, authenticated;

INSERT INTO public.training_milestones (threshold, label) VALUES
  (50000000,  'Training run 1 — 50M clean tokens'),
  (100000000, 'Training run 2 — 100M clean tokens'),
  (200000000, 'Training run 3 — 200M clean tokens (final, credits stop)')
ON CONFLICT (threshold) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_training_sample(
  p_user_id           uuid,
  p_model_id          text,
  p_source            text,
  p_messages          jsonb,
  p_completion        text,
  p_prompt_tokens     integer,
  p_completion_tokens integer,
  p_new_prompt_tokens integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  added bigint := GREATEST(COALESCE(p_new_prompt_tokens, 0), 0)
                + GREATEST(COALESCE(p_completion_tokens, 0), 0);
  newtotal bigint;
BEGIN
  INSERT INTO public.training_samples
    (user_id, model_id, source, messages, completion,
     prompt_tokens, completion_tokens, new_prompt_tokens)
  VALUES
    (p_user_id, p_model_id, COALESCE(p_source, 'api'), p_messages,
     COALESCE(p_completion, ''),
     GREATEST(COALESCE(p_prompt_tokens, 0), 0),
     GREATEST(COALESCE(p_completion_tokens, 0), 0),
     GREATEST(COALESCE(p_new_prompt_tokens, 0), 0));

  UPDATE public.training_program
     SET captured_tokens = captured_tokens + added,
         active = active AND (captured_tokens + added) < token_goal,
         updated_at = now()
   WHERE id = 1
   RETURNING captured_tokens INTO newtotal;

  UPDATE public.training_milestones
     SET reached = true, reached_at = now()
   WHERE NOT reached AND threshold <= newtotal;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_training_sample(uuid, text, text, jsonb, text, integer, integer, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_training_sample(uuid, text, text, jsonb, text, integer, integer, integer)
  TO service_role;

UPDATE public.training_milestones
   SET reached = true, reached_at = COALESCE(reached_at, now())
 WHERE NOT reached
   AND threshold <= (SELECT captured_tokens FROM public.training_program WHERE id = 1);
