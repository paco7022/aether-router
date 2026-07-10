-- Atomic slot management for the Kiro community pool. All reservations
-- serialize on a single advisory lock so the global cap can't be exceeded by
-- concurrent contributions.

create or replace function public.reserve_kiro_pool_slot(
  p_token_hash text,
  p_user uuid,
  p_max int
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int;
begin
  perform pg_advisory_xact_lock(hashtext('kiro_pool_slot'));

  if exists (
    select 1 from public.kiro_pool_accounts
    where token_hash = p_token_hash and status = 'active'
  ) then
    return 'duplicate';
  end if;

  select count(*) into v_active
  from public.kiro_pool_accounts
  where status = 'active';

  if v_active >= p_max then
    return 'full';
  end if;

  insert into public.kiro_pool_accounts (token_hash, contributor_user_id, filename, status)
  values (p_token_hash, p_user, 'pending', 'active');

  return 'ok';
end;
$$;

create or replace function public.finalize_kiro_pool_slot(
  p_token_hash text,
  p_filename text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.kiro_pool_accounts
  set filename = p_filename
  where token_hash = p_token_hash and status = 'active';
$$;

-- Release only an un-finalized reservation (capture failed).
create or replace function public.release_kiro_pool_slot(
  p_token_hash text
) returns void
language sql
security definer
set search_path = public
as $$
  delete from public.kiro_pool_accounts
  where token_hash = p_token_hash and status = 'active' and filename = 'pending';
$$;

create or replace function public.mark_kiro_pool_dead(
  p_filename text,
  p_reason text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.kiro_pool_accounts
  set status = 'dead', died_at = now(), dead_reason = p_reason
  where filename = p_filename and status = 'active';
$$;

revoke execute on function public.reserve_kiro_pool_slot(text, uuid, int) from anon, authenticated;
revoke execute on function public.finalize_kiro_pool_slot(text, text) from anon, authenticated;
revoke execute on function public.release_kiro_pool_slot(text) from anon, authenticated;
revoke execute on function public.mark_kiro_pool_dead(text, text) from anon, authenticated;
