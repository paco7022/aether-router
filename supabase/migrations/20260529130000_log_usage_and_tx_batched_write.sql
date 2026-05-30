-- Applied to remote via Supabase MCP; this file mirrors it for repo history.
-- Batch the per-request usage_log insert + (optional) transaction ledger insert
-- into a single function call: one round-trip and one commit/fsync instead of
-- two. Pure logging — credit settlement already happened via the reserve/
-- deduct RPCs before this is called, so a failure here never affects billing
-- (mirrors the previous fire-and-error-log behaviour).
create or replace function public.log_usage_and_tx(
  p_user_id uuid,
  p_api_key_id uuid,
  p_model_id text,
  p_prompt_tokens int,
  p_completion_tokens int,
  p_total_tokens int,
  p_credits_charged bigint,
  p_cost_usd numeric,
  p_status text,
  p_duration_ms int,
  p_premium_cost numeric,
  p_cache_read_tokens int,
  p_cache_write_tokens int,
  p_source text,
  p_estimated_prompt_tokens int,
  p_finish_reason text,
  -- transaction is written only when p_tx_amount is not null
  p_tx_amount bigint default null,
  p_tx_balance bigint default null,
  p_tx_type text default null,
  p_tx_description text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_logs(
    user_id, api_key_id, model_id, prompt_tokens, completion_tokens, total_tokens,
    cache_read_tokens, cache_write_tokens, credits_charged, cost_usd, status,
    duration_ms, premium_cost, source, estimated_prompt_tokens, finish_reason
  ) values (
    p_user_id, p_api_key_id, p_model_id, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_cache_read_tokens, p_cache_write_tokens, p_credits_charged, p_cost_usd, p_status,
    p_duration_ms, p_premium_cost, p_source, p_estimated_prompt_tokens, p_finish_reason
  );

  if p_tx_amount is not null then
    insert into public.transactions(user_id, amount, balance, type, description)
    values (p_user_id, p_tx_amount, p_tx_balance, p_tx_type, p_tx_description);
  end if;
end;
$$;

revoke all on function public.log_usage_and_tx(uuid,uuid,text,int,int,int,bigint,numeric,text,int,numeric,int,int,text,int,text,bigint,bigint,text,text) from public, anon, authenticated;
grant execute on function public.log_usage_and_tx(uuid,uuid,text,int,int,int,bigint,numeric,text,int,numeric,int,int,text,int,text,bigint,bigint,text,text) to service_role;
