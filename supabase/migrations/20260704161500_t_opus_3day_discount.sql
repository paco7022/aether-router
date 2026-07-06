-- 3-day promo (2026-07-04 → 2026-07-07): t/ Claude Opus premium_request_cost 6 -> 3.
-- Sonnet is untouched (stays at 3). t/ is already open to everyone including the
-- free tier (see claude-block.ts CLAUDE_PAID_ONLY_BYPASS / CLAUDE_ACTIVATION_BYPASS),
-- so free users benefit directly: each Opus request now burns 3 (not 6) from the
-- daily pool. Mirrors the r/ discount pattern — models.premium_request_cost is
-- numeric and reserve_premium_request accepts fractions. DB-only, no code change.
-- Auto-reverts via pg_cron on/after 2026-07-07 16:11 UTC.

update public.models
set premium_request_cost = 3.00
where provider = 'trolllm'
  and is_active
  and id ilike 't/%opus%';

create or replace function public.end_t_opus_discount()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- guard: no-op until the promo window closes
  if now() < timestamptz '2026-07-07 16:11:00+00' then
    return;
  end if;

  update public.models
  set premium_request_cost = 6.00
  where provider = 'trolllm'
    and is_active
    and id ilike 't/%opus%';

  perform cron.unschedule('end_t_opus_discount');
end;
$$;

revoke execute on function public.end_t_opus_discount() from public, anon, authenticated;

-- Daily check at 16:20 UTC; first firing past the guard = 2026-07-07 16:20 UTC.
select cron.schedule('end_t_opus_discount', '20 16 * * *', $$select public.end_t_opus_discount();$$);
