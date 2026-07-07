-- ============================================================
-- Gifting: buy credits or a plan for a friend (by email)
-- ============================================================
--
-- A buyer pays through the SAME Stripe checkout used for their own
-- purchases (billing/gift/route.ts, mode=payment), but the metadata carries
-- purchase_type='gift' + a recipient email. The webhook calls process_gift()
-- with the Stripe event id as the idempotency key.
--
-- Two delivery paths, both idempotent:
--   1. Recipient already has an account  -> applied immediately.
--   2. Recipient has NO account yet      -> parked in pending_gifts and
--      auto-claimed by an AFTER INSERT trigger on profiles when that email
--      registers (also reclaimable on demand via /billing/claim-gifts).
--
-- Anti-abuse note: claiming a gift never fires grant_paid_referral_bonus and
-- never touches the multiaccount/referral machinery. A gift is value transfer,
-- not a "paid conversion" of the recipient.

-- Distinguish gifted plan grants (one-time, N days, auto-expiring) from real
-- recurring Stripe subscriptions and from the always-on 'free' subscription.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'stripe';

CREATE TABLE IF NOT EXISTS public.pending_gifts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email     text NOT NULL,                 -- normalized lower(trim())
  gift_type           text NOT NULL CHECK (gift_type IN ('credits','plan')),
  credits             bigint,                         -- for gift_type='credits'
  plan_id             text REFERENCES public.plans(id),
  plan_days           integer,                        -- for gift_type='plan'
  message             text,                           -- optional note from sender
  stripe_event_id     text NOT NULL UNIQUE,           -- idempotency key
  status              text NOT NULL DEFAULT 'paid_pending'
                      CHECK (status IN ('paid_pending','claimed','refunded','expired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  claimed_at          timestamptz,
  claimed_by_user_id  uuid REFERENCES public.profiles(id),
  expires_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pending_gifts_recipient_open
  ON public.pending_gifts (recipient_email)
  WHERE status = 'paid_pending';

CREATE INDEX IF NOT EXISTS idx_pending_gifts_sender
  ON public.pending_gifts (sender_user_id, created_at DESC);

ALTER TABLE public.pending_gifts ENABLE ROW LEVEL SECURITY;

-- Senders can see the gifts they bought (and their claim status). Recipients
-- see their received gifts once claimed via their transactions ledger.
DROP POLICY IF EXISTS "Senders can view their gifts" ON public.pending_gifts;
CREATE POLICY "Senders can view their gifts"
  ON public.pending_gifts FOR SELECT
  USING (auth.uid() = sender_user_id);

-- ============================================================
-- claim_gift(gift_id, recipient_user_id)
-- Applies ONE paid_pending gift to a concrete user, atomically. Idempotent:
-- it locks the row and no-ops unless status is still 'paid_pending'.
-- Returns true when it applied the gift, false when it was already handled.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_gift(
  p_gift_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g            public.pending_gifts%ROWTYPE;
  gift_price   numeric;
  cur_price    numeric;
  plan_name    text;
  newbal       bigint;
  credits_equiv bigint;
  existing_sub_id uuid;
  days         integer;
BEGIN
  -- Lock the gift so concurrent claims (webhook vs signup trigger) serialize.
  SELECT * INTO g FROM public.pending_gifts
    WHERE id = p_gift_id FOR UPDATE;

  IF NOT FOUND OR g.status <> 'paid_pending' THEN
    RETURN false;              -- unknown or already claimed/refunded/expired
  END IF;

  -- ── Credits gift ──
  IF g.gift_type = 'credits' THEN
    IF COALESCE(g.credits, 0) <= 0 THEN
      RETURN false;
    END IF;

    UPDATE public.profiles
      SET credits = credits + g.credits,
          is_activated = true,
          claude_activated = true,
          updated_at = now()
      WHERE id = p_user_id
      RETURNING credits INTO newbal;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'claim_gift: recipient % not found', p_user_id;
    END IF;

    INSERT INTO public.transactions (user_id, amount, balance, type, reference, description)
      VALUES (p_user_id, g.credits, newbal, 'gift_received', 'gift:' || g.id,
              'Received gift: ' || g.credits::text || ' credits');

  -- ── Plan gift ──
  ELSIF g.gift_type = 'plan' THEN
    days := GREATEST(COALESCE(g.plan_days, 30), 1);

    SELECT price_usd, name INTO gift_price, plan_name
      FROM public.plans WHERE id = g.plan_id;
    IF gift_price IS NULL THEN
      RAISE EXCEPTION 'claim_gift: plan % not found', g.plan_id;
    END IF;

    SELECT pl.price_usd INTO cur_price
      FROM public.profiles pr
      JOIN public.plans pl ON pl.id = pr.plan_id
      WHERE pr.id = p_user_id;

    IF gift_price >= COALESCE(cur_price, 0) THEN
      -- Recipient is not on a more expensive plan: grant the tier.
      -- Extend in place if they already hold an active gifted grant of the
      -- SAME plan (stacking days); otherwise start a fresh gifted window and
      -- retire any other active gifted grant (never stack different tiers).
      SELECT id INTO existing_sub_id FROM public.subscriptions
        WHERE user_id = p_user_id AND source = 'gift' AND status = 'active'
          AND plan_id = g.plan_id AND current_period_end > now()
        ORDER BY current_period_end DESC LIMIT 1;

      IF existing_sub_id IS NOT NULL THEN
        UPDATE public.subscriptions
          SET current_period_end = current_period_end + make_interval(days => days),
              updated_at = now()
          WHERE id = existing_sub_id;
      ELSE
        UPDATE public.subscriptions
          SET status = 'expired', updated_at = now()
          WHERE user_id = p_user_id AND source = 'gift' AND status = 'active';

        INSERT INTO public.subscriptions
          (user_id, plan_id, status, source, current_period_start, current_period_end)
          VALUES (p_user_id, g.plan_id, 'active', 'gift',
                  now(), now() + make_interval(days => days));
      END IF;

      UPDATE public.profiles
        SET plan_id = g.plan_id,
            is_activated = true,
            claude_activated = true,
            updated_at = now()
        WHERE id = p_user_id
        RETURNING credits INTO newbal;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'claim_gift: recipient % not found', p_user_id;
      END IF;

      INSERT INTO public.transactions (user_id, amount, balance, type, reference, description)
        VALUES (p_user_id, 0, newbal, 'gift_plan', 'gift:' || g.id,
                'Received gift: ' || plan_name || ' plan for ' || days::text || ' days');
    ELSE
      -- Recipient already pays for an equal/better plan: don't downgrade them.
      -- Convert the gift's dollar value to permanent credits at $1 = 10,000 cr
      -- so the gift is never lost.
      credits_equiv := round(gift_price * 10000)::bigint;

      UPDATE public.profiles
        SET credits = credits + credits_equiv,
            updated_at = now()
        WHERE id = p_user_id
        RETURNING credits INTO newbal;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'claim_gift: recipient % not found', p_user_id;
      END IF;

      INSERT INTO public.transactions (user_id, amount, balance, type, reference, description)
        VALUES (p_user_id, credits_equiv, newbal, 'gift_received', 'gift:' || g.id,
                'Gift credited as ' || credits_equiv::text ||
                ' credits (already on a higher plan)');
    END IF;
  ELSE
    RETURN false;
  END IF;

  UPDATE public.pending_gifts
    SET status = 'claimed',
        claimed_at = now(),
        claimed_by_user_id = p_user_id
    WHERE id = g.id;

  RETURN true;
END;
$$;

-- ============================================================
-- process_gift(...)  — webhook entry point
-- Records the gift (idempotent by Stripe event id) and, if the recipient
-- already has an account, claims it immediately. Returns the resulting status.
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_gift(
  p_event_id        text,
  p_sender_user_id  uuid,
  p_recipient_email text,
  p_gift_type       text,
  p_credits         bigint,
  p_plan_id         text,
  p_plan_days       integer,
  p_message         text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm_email  text := lower(trim(p_recipient_email));
  gift_id     uuid;
  recipient   uuid;
BEGIN
  IF norm_email IS NULL OR norm_email = '' THEN
    RAISE EXCEPTION 'process_gift: empty recipient email (event %)', p_event_id;
  END IF;

  -- Idempotent insert keyed on the Stripe event id.
  INSERT INTO public.pending_gifts
    (sender_user_id, recipient_email, gift_type, credits, plan_id, plan_days,
     message, stripe_event_id, expires_at)
    VALUES
    (p_sender_user_id, norm_email, p_gift_type,
     NULLIF(p_credits, 0), p_plan_id, p_plan_days,
     p_message, p_event_id, now() + interval '1 year')
    ON CONFLICT (stripe_event_id) DO NOTHING
    RETURNING id INTO gift_id;

  IF gift_id IS NULL THEN
    -- Redelivery: fetch the row we already recorded.
    SELECT id INTO gift_id FROM public.pending_gifts
      WHERE stripe_event_id = p_event_id;
  END IF;

  -- Apply now if the recipient already exists.
  SELECT id INTO recipient FROM public.profiles
    WHERE lower(email) = norm_email
    ORDER BY created_at ASC LIMIT 1;

  IF recipient IS NOT NULL THEN
    PERFORM public.claim_gift(gift_id, recipient);
  END IF;

  RETURN (SELECT status FROM public.pending_gifts WHERE id = gift_id);
END;
$$;

-- ============================================================
-- claim_pending_gifts_for_user(user_id)
-- Claims every open gift addressed to this user's email. Used by the signup
-- trigger and by the manual /billing/claim-gifts endpoint. Returns the count
-- of gifts applied.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_pending_gifts_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email text;
  g_id       uuid;
  applied    integer := 0;
BEGIN
  SELECT lower(email) INTO user_email FROM public.profiles WHERE id = p_user_id;
  IF user_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR g_id IN
    SELECT id FROM public.pending_gifts
      WHERE status = 'paid_pending'
        AND recipient_email = user_email
      ORDER BY created_at ASC
  LOOP
    IF public.claim_gift(g_id, p_user_id) THEN
      applied := applied + 1;
    END IF;
  END LOOP;

  RETURN applied;
END;
$$;

-- Auto-claim gifts the moment a matching email registers.
CREATE OR REPLACE FUNCTION public.trg_claim_gifts_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.claim_pending_gifts_for_user(NEW.id);
  RETURN NEW;
END;
$$;

-- The trigger runs as the table owner, so revoking EXECUTE doesn't disable it;
-- it just keeps the function off the exposed PostgREST RPC surface.
REVOKE EXECUTE ON FUNCTION public.trg_claim_gifts_on_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS claim_gifts_on_signup ON public.profiles;
CREATE TRIGGER claim_gifts_on_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_claim_gifts_on_signup();

-- ============================================================
-- expire_gifted_plans()  — hourly cron
-- Retires gifted plan windows past their end and, for users left without an
-- active subscription backing their current plan, reverts them to their best
-- remaining active plan (or 'free'). Scoped to users actually affected this
-- run so it never churns unrelated profiles.
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_gifted_plans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reverted integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.subscriptions
      SET status = 'expired', updated_at = now()
      WHERE source = 'gift' AND status = 'active' AND current_period_end < now()
      RETURNING user_id
  )
  UPDATE public.profiles p
    SET plan_id = COALESCE((
          SELECT s.plan_id FROM public.subscriptions s
          JOIN public.plans pl ON pl.id = s.plan_id
          WHERE s.user_id = p.id AND s.status = 'active'
          ORDER BY pl.price_usd DESC
          LIMIT 1
        ), 'free'),
        updated_at = now()
    WHERE p.id IN (SELECT DISTINCT user_id FROM expired)
      AND p.plan_id <> 'free'
      AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = p.id AND s.status = 'active' AND s.plan_id = p.plan_id
      );

  GET DIAGNOSTICS reverted = ROW_COUNT;
  RETURN reverted;
END;
$$;

-- Lock down execution: only service_role / cron may run these.
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_gift(text, uuid, text, text, bigint, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_pending_gifts_for_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_gifted_plans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gift(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_gift(text, uuid, text, text, bigint, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_gifts_for_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_gifted_plans() TO service_role;

-- Hourly sweep for expired gifted plans.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-gifted-plans') THEN
    PERFORM cron.unschedule('expire-gifted-plans');
  END IF;
  PERFORM cron.schedule('expire-gifted-plans', '17 * * * *', 'SELECT public.expire_gifted_plans();');
END $$;
