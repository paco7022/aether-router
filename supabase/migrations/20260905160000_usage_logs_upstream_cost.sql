-- ============================================================
-- usage_logs.upstream_cost_usd — lo que la request nos costó AL PROVEEDOR
-- 2026-09-05
--
-- POR QUÉ: `cost_usd` es ambiguo. En la ruta normal guarda nuestro coste
-- upstream, pero en PAYG y en las keys enterprise (flat_per_token) se
-- sobreescribe con lo COBRADO al cliente. Así no se puede auditar la factura
-- del proveedor, y menos ahora que ZenLLM nos aplicó un descuento temporal
-- (solo este mes) que hay que verificar contra su panel: su API no expone
-- ningún endpoint de gasto.
--
-- QUÉ GUARDA: el coste calculado con los tokens que REPORTA EL UPSTREAM
-- (no nuestro estimado — el proveedor factura por SU conteo, inflado o no)
-- por los cost_per_m_* del modelo en el momento de la request. Se escribe
-- SIEMPRE, en todos los modos de cobro, incluidos free pools y promos
-- zero-cost: ahí el cliente paga 0 pero a nosotros nos sigue costando.
--
-- Tampoco sirve recalcularlo después: cost_per_m_* cambia (hoy mismo cambió
-- ×10 con el descuento), así que el coste histórico solo es fiable si se
-- congela por fila en el momento.
--
-- El parámetro nuevo del RPC va con DEFAULT NULL para que el código viejo
-- (que pasa 20 argumentos) siga funcionando: aplicar esta migración ANTES
-- del deploy es seguro. Se hace DROP + CREATE en vez de CREATE OR REPLACE
-- porque añadir un parámetro crea una sobrecarga nueva y las llamadas por
-- nombre quedarían ambiguas entre las dos firmas.
-- ============================================================

ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS upstream_cost_usd NUMERIC(14,10);

COMMENT ON COLUMN public.usage_logs.upstream_cost_usd IS
  'Coste real al proveedor: tokens reportados por el upstream x cost_per_m_* del modelo en ese momento. Independiente de lo cobrado al cliente (cost_usd/credits_charged).';

DROP FUNCTION IF EXISTS public.log_usage_and_tx(uuid,uuid,text,int,int,int,bigint,numeric,text,int,numeric,int,int,text,int,text,bigint,bigint,text,text);

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
  p_tx_description text default null,
  p_upstream_cost_usd numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_logs(
    user_id, api_key_id, model_id, prompt_tokens, completion_tokens, total_tokens,
    cache_read_tokens, cache_write_tokens, credits_charged, cost_usd, status,
    duration_ms, premium_cost, source, estimated_prompt_tokens, finish_reason,
    upstream_cost_usd
  ) values (
    p_user_id, p_api_key_id, p_model_id, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_cache_read_tokens, p_cache_write_tokens, p_credits_charged, p_cost_usd, p_status,
    p_duration_ms, p_premium_cost, p_source, p_estimated_prompt_tokens, p_finish_reason,
    p_upstream_cost_usd
  );

  if p_tx_amount is not null then
    insert into public.transactions(user_id, amount, balance, type, description)
    values (p_user_id, p_tx_amount, p_tx_balance, p_tx_type, p_tx_description);
  end if;
end;
$$;

revoke all on function public.log_usage_and_tx(uuid,uuid,text,int,int,int,bigint,numeric,text,int,numeric,int,int,text,int,text,bigint,bigint,text,text,numeric) from public, anon, authenticated;
grant execute on function public.log_usage_and_tx(uuid,uuid,text,int,int,int,bigint,numeric,text,int,numeric,int,int,text,int,text,bigint,bigint,text,text,numeric) to service_role;
