-- ============================================================
-- Training program: count only NEW content per turn toward the goal
-- ============================================================
-- The capture stores the full input transcript per request, so a long
-- conversation re-sends the (large) system card + history every turn. Counting
-- full prompt+completion tallied that repeated context once per request,
-- inflating captured_tokens ~14x. The goal should reflect UNIQUE signal: the
-- new user turn + the assistant reply. Full `messages` are still stored intact
-- for training — only the goal counter changes.
-- ============================================================

ALTER TABLE public.training_samples
  ADD COLUMN IF NOT EXISTS new_prompt_tokens integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.record_training_sample(uuid, text, text, jsonb, text, integer, integer);

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
   WHERE id = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_training_sample(uuid, text, text, jsonb, text, integer, integer, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_training_sample(uuid, text, text, jsonb, text, integer, integer, integer)
  TO service_role;

-- Backfill existing rows (~chars/4 for the last user turn; SQL has no
-- tokenizer) and recompute the program counter from the corrected values.
UPDATE public.training_samples
   SET new_prompt_tokens = CEIL(
         char_length(COALESCE(messages -> (jsonb_array_length(messages)-1) ->> 'content', '')) / 4.0
       )::int
 WHERE new_prompt_tokens = 0;

UPDATE public.training_program
   SET captured_tokens = COALESCE(
         (SELECT sum(new_prompt_tokens + completion_tokens) FROM public.training_samples), 0),
       updated_at = now()
 WHERE id = 1;
