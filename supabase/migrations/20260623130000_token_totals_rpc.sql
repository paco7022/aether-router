-- Aggregate token-consumption totals for the admin Stats tab.
--
-- Powers the weekly / monthly / all-time token counters used to track the
-- router's growth and consumption (e.g. for an eventual AWS partner
-- application). This is a heavy SUM over usage_logs, so the call site caches
-- the result (TtlCache, ~15 min) to protect the shared compute's Disk IO
-- budget — see the 2026-06-08 outage notes. Admin-only at the API layer.
--
-- Returns successful billable rows only (status = 'success') so failed/early
-- requests don't inflate the consumption numbers.

create or replace function public.get_token_totals()
returns table (
  tokens_7d   bigint,
  tokens_30d  bigint,
  tokens_all  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(total_tokens) filter (where created_at >= now() - interval '7 days'), 0)::bigint  as tokens_7d,
    coalesce(sum(total_tokens) filter (where created_at >= now() - interval '30 days'), 0)::bigint as tokens_30d,
    coalesce(sum(total_tokens), 0)::bigint as tokens_all
  from public.usage_logs
  where status = 'success';
$$;

-- Lock down execution: only the service role (used by the admin API route)
-- may call this. No anon/authenticated access — these are sensitive
-- business-scale metrics.
revoke all on function public.get_token_totals() from public, anon, authenticated;
grant execute on function public.get_token_totals() to service_role;

-- Partial index to keep the time-windowed SUMs from full-scanning the table.
create index if not exists idx_usage_logs_created_success
  on public.usage_logs (created_at)
  where status = 'success';
