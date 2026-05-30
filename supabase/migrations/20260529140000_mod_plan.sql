-- Applied to remote via Supabase MCP; this file mirrors it for repo history.
-- `mod` plan: a gifted moderator tier that mirrors Pro's benefits exactly
-- (cloned from the pro row so it can never drift on the billing side) but is
-- hidden from the public pricing page (is_active=false, price 0). Assigned by
-- an admin via the user plan dropdown. Being a non-"free" plan, all the
-- free-tier gates (activation, Claude, paid-only credits) treat it like Pro.
-- The limited admin-panel access is gated separately on plan_id='mod'.
insert into public.plans (
  id, name, description, price_usd, credits_per_day, credits_per_month, bonus_pct,
  is_popular, sort_order, is_active, gm_daily_requests, gm_max_context,
  stripe_price_id, allowed_providers, unlimited_providers
)
select
  'mod', 'Mod', 'Moderator — Pro benefits + limited moderation panel', 0,
  credits_per_day, credits_per_month, bonus_pct,
  false, 99, false, gm_daily_requests, gm_max_context,
  null, allowed_providers, unlimited_providers
from public.plans where id = 'pro'
on conflict (id) do nothing;
