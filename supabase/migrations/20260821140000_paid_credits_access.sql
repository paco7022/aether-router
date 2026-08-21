-- ============================================================
-- Pay-as-you-go access via purchased credits (2026-08-21)
--
-- The free tier is gone (20260821120000_remove_free_tier.sql), so the only way
-- in was a monthly plan. This adds the second door: BUY CREDITS and route
-- pay-as-you-go, no subscription.
--
--   profiles.is_paid = true  →  the account may route even on plan_id='free'.
--
-- The invariant is enforced entirely by triggers so every path that moves money
-- (Stripe webhook RPCs, gifts, admin tools, refunds, settlement) stays honest
-- without app changes:
--
--   1) a 'purchase'/'gift_received' transaction turns is_paid ON, and puts a
--      free-plan account into 'payg' billing (per-token). Per-request billing
--      is meaningless without a plan: it draws a daily premium pool the free
--      row no longer has.
--   2) is_paid can never be true below MIN_PAID_CREDITS (100) permanent
--      credits. Any UPDATE that drops the balance under the floor clears it.
--
-- Only PERMANENT credits count (profiles.credits) — daily plan credits live in
-- profiles.daily_credits and are not purchased.
--
-- Admin grants do NOT unlock access on purpose: mass compensation grants
-- (see scripts/grant-compensation.mjs) would otherwise hand routing to
-- everyone. Only 'purchase' (Stripe) and 'gift_received' (someone paid for
-- them) count.
--
-- To revert: drop both triggers and stop reading is_paid in src/lib/free-tier.ts.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_paid IS
  'Bought credits and still holds >= 100 permanent credits. Lets a plan_id=free account route pay-as-you-go. Maintained by triggers, not by app code.';

-- 1) Purchase / gift → unlock (and force payg on free accounts).
CREATE OR REPLACE FUNCTION public.mark_profile_paid_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type IN ('purchase', 'gift_received') THEN
    UPDATE public.profiles
    SET is_paid = true,
        -- Free accounts have no premium pool to draw from, so per-request
        -- billing would dead-end at "daily limit reached". Subscribers keep
        -- whatever mode they chose.
        billing_mode = CASE WHEN plan_id = 'free' THEN 'payg' ELSE billing_mode END
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_mark_paid ON public.transactions;
CREATE TRIGGER trg_transactions_mark_paid
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_profile_paid_on_purchase();

-- 2) Balance floor. Runs on EVERY profiles update, including the one above, so
--    a purchase too small to clear the floor never grants access.
CREATE OR REPLACE FUNCTION public.enforce_is_paid_credit_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_paid AND COALESCE(NEW.credits, 0) < 100 THEN
    NEW.is_paid := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_is_paid_floor ON public.profiles;
CREATE TRIGGER trg_profiles_is_paid_floor
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_is_paid_credit_floor();

-- 3) Backfill: anyone who already paid and still holds the floor keeps routing
--    through the free-tier removal instead of being cut off.
UPDATE public.profiles p
SET is_paid = true,
    billing_mode = CASE WHEN p.plan_id = 'free' THEN 'payg' ELSE p.billing_mode END
WHERE p.credits >= 100
  AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = p.id
      AND t.type IN ('purchase', 'gift_received')
  );
