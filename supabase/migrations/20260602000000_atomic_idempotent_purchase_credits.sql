-- Atomic + idempotent credit-purchase grant.
--
-- Incident 2026-06-02: a 50k purchase was charged in Stripe but the credits
-- never landed. Root cause: the webhook called add_credits() WITHOUT checking
-- its result, then separately read the profile and inserted the ledger row.
-- When add_credits failed/returned -1 transiently (PC-hybrid fetch hiccup),
-- execution continued: the transaction row was written with the *stale*
-- balance, the event was marked success=true, and Stripe never retried. The
-- grant and the ledger insert were also non-atomic.
--
-- This replaces that multi-step dance with ONE function that, in a single
-- transaction:
--   1. is idempotent by p_reference (the Stripe event id) — re-running returns
--      the already-applied balance instead of double-granting,
--   2. increments profiles.credits and flips the activation gates,
--   3. inserts the ledger row with the correct post-grant balance + reference,
--   4. returns the new balance (or RAISES, so the caller can fail loudly).

-- Partial unique index: belt-and-suspenders against a concurrent double
-- delivery racing past the in-function existence check. Only purchases with a
-- non-null reference are constrained, so legacy NULL-reference rows are
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_purchase_reference_uniq
  ON public.transactions (reference)
  WHERE type = 'purchase' AND reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purchase_credits(
  p_user_id uuid,
  p_amount bigint,
  p_description text,
  p_reference text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_balance BIGINT;
  existing_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'purchase_credits: invalid amount %', p_amount;
  END IF;

  -- Idempotency: if this Stripe event was already applied, return its balance.
  IF p_reference IS NOT NULL THEN
    SELECT balance INTO existing_balance
    FROM public.transactions
    WHERE type = 'purchase' AND reference = p_reference
    LIMIT 1;
    IF FOUND THEN
      RETURN existing_balance;
    END IF;
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_amount,
      is_activated = true,
      claude_activated = true,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_credits: user % not found', p_user_id;
  END IF;

  INSERT INTO public.transactions (user_id, amount, balance, type, reference, description)
  VALUES (p_user_id, p_amount, new_balance, 'purchase', p_reference, p_description);

  RETURN new_balance;
END;
$function$;

ALTER FUNCTION public.purchase_credits(uuid, bigint, text, text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.purchase_credits(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purchase_credits(uuid, bigint, text, text) TO service_role;
