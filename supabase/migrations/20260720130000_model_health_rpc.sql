-- ============================================================
-- Model health aggregation for the public status page (/status).
--
-- usage_logs already records provider outages: the chat-completions route
-- writes a zero-cost row with status = 'error_<http status>' (or
-- 'error_empty') whenever an upstream call fails, alongside the normal
-- status = 'success' rows. This RPC rolls those up per model so the status
-- page can say "operational / degraded / down / no recent traffic" without
-- every page view scanning the log table.
--
-- IO NOTE (see the 2026-06-08 Disk-IO outage): the call site caches the
-- result for ~15 min (TtlCache + s-maxage), and this function is written as
-- a UNION ALL of two status-predicated branches so each side can use its own
-- partial index on created_at instead of seq-scanning usage_logs:
--   idx_usage_logs_created_success  (status = 'success')     -- pre-existing
--   idx_usage_logs_created_error    (status <> 'success')    -- added below,
--     tiny: only failure rows are indexed.
--
-- Returns one row per model that saw ANY traffic in the window. Models with
-- no rows at all are absent → the app renders them as "no recent traffic".
-- ============================================================

create index if not exists idx_usage_logs_created_error
  on public.usage_logs (created_at)
  where status <> 'success';

create or replace function public.get_model_health(
  p_window_minutes  int default 1440,
  p_recent_minutes  int default 60
)
returns table (
  model_id      text,
  ok_recent     bigint,
  err_recent    bigint,
  ok_window     bigint,
  err_window    bigint,
  last_ok       timestamptz,
  last_err      timestamptz,
  last_err_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      now() - make_interval(mins => greatest(p_window_minutes, 1)) as window_start,
      now() - make_interval(mins => greatest(p_recent_minutes, 1)) as recent_start
  ),
  rows as (
    select u.model_id, u.created_at, u.status
      from public.usage_logs u, bounds b
     where u.status = 'success'
       and u.created_at >= b.window_start
    union all
    select u.model_id, u.created_at, u.status
      from public.usage_logs u, bounds b
     where u.status <> 'success'
       and u.created_at >= b.window_start
  )
  select
    r.model_id,
    count(*) filter (where r.status =  'success' and r.created_at >= b.recent_start)::bigint as ok_recent,
    count(*) filter (where r.status <> 'success' and r.created_at >= b.recent_start)::bigint as err_recent,
    count(*) filter (where r.status =  'success')::bigint as ok_window,
    count(*) filter (where r.status <> 'success')::bigint as err_window,
    max(r.created_at) filter (where r.status =  'success') as last_ok,
    max(r.created_at) filter (where r.status <> 'success') as last_err,
    (array_agg(r.status order by r.created_at desc) filter (where r.status <> 'success'))[1] as last_err_code
  from rows r, bounds b
  group by r.model_id;
$$;

-- Public status page reads this through the service-role admin client only.
-- security definer is required because usage_logs RLS scopes rows to their
-- owner; the function only ever returns aggregates, never per-user data.
revoke all on function public.get_model_health(int, int) from public, anon, authenticated;
grant execute on function public.get_model_health(int, int) to service_role;
