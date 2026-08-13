-- ============================================================
-- rout.my (rt/) — add moonshotai/kimi-k3-moonshot.
--
-- Confirmado vivo en el catalogo upstream (GET {ROUTMY_BASE_URL}/models).
-- rout.my expone cuatro variantes de K3 (kimi-k3, -fast, -moonshot, -hosted);
-- esta fila es solo la -moonshot, de ahi el display_name explicito.
--
-- Tier x5, igual que oc/kimi-k3 y r/kimi-k3 (ver 20260720120000): K3 es el
-- flagship de Moonshot y va por encima de las K2.x, que en rt/ estan en x1.
--
-- Provider premium-pool: cost_per_m queda en 0 (se cobra 1 credito/request +
-- premium_request_cost contra el pool diario). margin 1.55 como el resto de rt/.
-- payg_credits_per_m_* = 300/2000, la convencion de clase Kimi.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost,
  payg_credits_per_m_input, payg_credits_per_m_output,
  capabilities
) VALUES
  ('rt/moonshotai/kimi-k3-moonshot', 'routmy', 'moonshotai/kimi-k3-moonshot', 'Kimi K3 Moonshot', 0, 0, 0, 0, 1.5500, true, 5.00, 300, 2000, '["tool_calling", "streaming", "system_message"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  provider                  = EXCLUDED.provider,
  upstream_model_id         = EXCLUDED.upstream_model_id,
  display_name              = EXCLUDED.display_name,
  cost_per_m_input          = EXCLUDED.cost_per_m_input,
  cost_per_m_output         = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read     = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write    = EXCLUDED.cost_per_m_cache_write,
  margin                    = EXCLUDED.margin,
  is_active                 = EXCLUDED.is_active,
  premium_request_cost      = EXCLUDED.premium_request_cost,
  payg_credits_per_m_input  = EXCLUDED.payg_credits_per_m_input,
  payg_credits_per_m_output = EXCLUDED.payg_credits_per_m_output,
  capabilities              = EXCLUDED.capabilities;
