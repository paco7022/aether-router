-- Atomic + idempotent prepaid top-up for a custom API key's credit pool.
--
-- Used by the enterprise self-service portal: a customer buys tokens via Stripe
-- ($3/M, min 100M) and the webhook credits THAT KEY's api_keys.custom_credits
-- (not profiles.credits). Mirrors purchase_credits (idempotent by the Stripe
-- event id) but targets a key and verifies ownership.

-- Idempotency guard: one applied top-up per Stripe event.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_enterprise_purchase_reference_uniq
  ON public.transactions (reference)
  WHERE type = 'enterprise_token_purchase' AND reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purchase_custom_key_credits(
  p_key_id uuid,
  p_user_id uuid,
  p_amount integer,
  p_description text,
  p_reference text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_balance INTEGER;
  existing_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'purchase_custom_key_credits: invalid amount %', p_amount;
  END IF;

  -- Idempotency: if this Stripe event was already applied, return current balance.
  IF p_reference IS NOT NULL THEN
    SELECT balance INTO existing_balance
    FROM public.transactions
    WHERE type = 'enterprise_token_purchase' AND reference = p_reference
    LIMIT 1;
    IF FOUND THEN
      SELECT custom_credits INTO new_balance FROM public.api_keys WHERE id = p_key_id;
      RETURN new_balance;
    END IF;
  END IF;

  -- Credit the key's pool. Ownership + custom-key checks in the WHERE clause so a
  -- mismatched key_id/user_id (or a non-custom key) grants nothing and RAISES.
  UPDATE public.api_keys
  SET custom_credits = COALESCE(custom_credits, 0) + p_amount
  WHERE id = p_key_id AND user_id = p_user_id AND is_custom = true
  RETURNING custom_credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_custom_key_credits: key % not found for user % (or not custom)', p_key_id, p_user_id;
  END IF;

  INSERT INTO public.transactions (user_id, amount, balance, type, reference, description)
  VALUES (p_user_id, p_amount, new_balance, 'enterprise_token_purchase', p_reference, p_description);

  RETURN new_balance;
END;
$function$;

ALTER FUNCTION public.purchase_custom_key_credits(uuid, uuid, integer, text, text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.purchase_custom_key_credits(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purchase_custom_key_credits(uuid, uuid, integer, text, text) TO service_role;
