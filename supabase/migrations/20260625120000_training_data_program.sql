-- ============================================================
-- Training-data program
-- ============================================================
-- A small set of users explicitly consented to have their full
-- conversations (input + model output) stored and used to fine-tune a
-- custom roleplay model, in exchange for a daily allowance of EXPIRING
-- credits. This migration adds:
--
--   1. Consent flags on profiles (auditable, revocable).
--   2. training_samples — the dataset itself. RLS-locked to the service
--      role only; no user/anon/authenticated access. This is OUR corpus,
--      never user-facing.
--   3. training_program — a singleton row holding the token goal and a
--      running counter. When captured (CLEAN) tokens reach the goal the
--      program flips inactive and the daily credit grant stops.
--   4. record_training_sample() — atomic insert + counter increment +
--      auto-deactivation. Called by the router AFTER the existing CSAM
--      moderation gate passes, so flagged content NEVER enters the corpus
--      (we must not persist `sexual/minors` content — same rule the rest
--      of the system enforces).
--   5. grant_training_credits() + cron — tops participants up to 10k
--      EXPIRING daily_credits each day while the program is active.
-- ============================================================

-- 1. Consent + grant-bookkeeping columns -------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS training_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS training_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS training_credits_last_granted_at date;

-- Participants are looked up by this flag every day by the credit cron.
CREATE INDEX IF NOT EXISTS idx_profiles_training_consent
  ON public.profiles (id) WHERE training_consent = true;

-- 2. The dataset ------------------------------------------------------------
-- `messages` holds the full input array exactly as submitted (system card +
-- history + latest user turn) and `completion` the model's reply — i.e. a
-- ready-made SFT (input -> target) pair for the roleplay fine-tune.
CREATE TABLE IF NOT EXISTS public.training_samples (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  model_id          TEXT,
  source            TEXT NOT NULL DEFAULT 'api',
  messages          JSONB NOT NULL,
  completion        TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_samples_user_created
  ON public.training_samples (user_id, created_at DESC);

-- RLS on, NO policies → only the service role (which bypasses RLS) can touch
-- it. Belt-and-suspenders: strip the default table grants too.
ALTER TABLE public.training_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_samples FROM anon, authenticated;

-- 3. Program state (singleton) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_program (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_goal      BIGINT  NOT NULL DEFAULT 100000000,   -- 100M clean tokens
  captured_tokens BIGINT  NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.training_program ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_program FROM anon, authenticated;

INSERT INTO public.training_program (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- 4. Atomic capture ----------------------------------------------------------
-- Insert one sample, advance the clean-token counter, and deactivate the
-- program once the goal is met — all in one statement-coherent call so the
-- counter can never drift from the rows. Only ever invoked by the router with
-- already-moderated (clean) content.
CREATE OR REPLACE FUNCTION public.record_training_sample(
  p_user_id          uuid,
  p_model_id         text,
  p_source           text,
  p_messages         jsonb,
  p_completion       text,
  p_prompt_tokens    integer,
  p_completion_tokens integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  added bigint := GREATEST(COALESCE(p_prompt_tokens, 0), 0)
                + GREATEST(COALESCE(p_completion_tokens, 0), 0);
BEGIN
  INSERT INTO public.training_samples
    (user_id, model_id, source, messages, completion, prompt_tokens, completion_tokens)
  VALUES
    (p_user_id, p_model_id, COALESCE(p_source, 'api'), p_messages,
     COALESCE(p_completion, ''), GREATEST(COALESCE(p_prompt_tokens, 0), 0),
     GREATEST(COALESCE(p_completion_tokens, 0), 0));

  UPDATE public.training_program
     SET captured_tokens = captured_tokens + added,
         active = active AND (captured_tokens + added) < token_goal,
         updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_training_sample(uuid, text, text, jsonb, text, integer, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_training_sample(uuid, text, text, jsonb, text, integer, integer)
  TO service_role;

-- 5. Daily expiring-credit grant --------------------------------------------
-- Tops each active participant up to AT LEAST 10k daily_credits (never lowers
-- a larger plan/booster grant). daily_credits are the EXPIRING bucket — unused
-- balance is reset by the next day's grants, so this is "10k per day, use it
-- or lose it". Idempotent per calendar day via training_credits_last_granted_at.
-- Stops automatically once the program is no longer active (goal reached).
CREATE OR REPLACE FUNCTION public.grant_training_credits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  granted int := 0;
  r record;
  newdaily bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.training_program WHERE id = 1 AND active) THEN
    RETURN 0;  -- program complete / paused: stop granting
  END IF;

  FOR r IN
    SELECT id, daily_credits
    FROM public.profiles
    WHERE training_consent = true
      AND (training_credits_last_granted_at IS NULL
           OR training_credits_last_granted_at < CURRENT_DATE)
  LOOP
    newdaily := GREATEST(r.daily_credits, 10000);

    UPDATE public.profiles
       SET daily_credits = newdaily,
           training_credits_last_granted_at = CURRENT_DATE,
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.transactions (user_id, amount, balance, type, description)
    SELECT r.id, (newdaily - r.daily_credits), p.daily_credits + p.credits,
           'training_grant', 'Daily training-program credits (expire if unused)'
    FROM public.profiles p WHERE p.id = r.id;

    granted := granted + 1;
  END LOOP;

  RETURN granted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_training_credits() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_training_credits() TO service_role;

-- 00:15 UTC — after the plan/booster grants (00:00–00:07) so the GREATEST
-- top-up sits on top of whatever the plan already granted that day.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'grant-training-credits') THEN
    PERFORM cron.unschedule('grant-training-credits');
  END IF;
  PERFORM cron.schedule('grant-training-credits', '15 0 * * *',
                        'SELECT public.grant_training_credits();');
END $$;

-- 6. Enrol the consenting users ---------------------------------------------
-- DATA step, intentionally NOT in this committed migration: enrolment flips
-- training_consent=true for the specific consenting accounts, which means
-- embedding their email addresses (PII). This repo is mirrored to a PUBLIC
-- GitHub backup, so the email list is applied directly against the live DB
-- (out of band) and deliberately kept out of version control.
--
--   UPDATE public.profiles
--      SET training_consent = true,
--          training_consent_at = COALESCE(training_consent_at, now())
--    WHERE lower(email) IN ( ...consenting users... );
