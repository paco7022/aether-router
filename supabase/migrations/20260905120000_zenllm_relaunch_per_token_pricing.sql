-- ============================================================
-- ZenLLM (z/) relaunch — per-token upstream, honestly priced
-- 2026-09-05
--
-- ZenLLM ya no es una key enterprise plana: su catálogo se factura
-- POR TOKEN (precios verificados contra api.zenllm.org/v1/models, que
-- son los ya descontados de su tabla pública). Eso obliga a poner un
-- precio real, no el placeholder de 'espejo de t/' que tenían los z/.
--
-- BASE DE CÁLCULO (plan más barato = Pro):
--   $8/mes / (75 premium requests/día × 30) = $0.003556 por request
--   10.000 créditos = $1  →  1 crédito = $0.0001
--   Request de referencia: 32.768 tok input (cap de contexto de Pro)
--   + 2.000 tok output. Margen ×1,10.
--
--   premium_request_cost      = ceil(coste_request × 1,10 / 0,003556)
--   context_surcharge_per_10k = precio_input × 10k × 1,10 / 0,003556
--   payg_credits_per_m_*      = precio × 10.000 × 1,10
--
-- DOS COLUMNAS NUEVAS:
--  · payg_only: el modelo SOLO se sirve en billing_mode=payg. Opus 4.8
--    sale a 20 premium requests por llamada y Fable 5 a 40 — cifras que
--    no tienen sentido contra un pool de 75/día. En per-token cada token
--    lleva su propio margen, así que ahí sí se venden sin perder dinero.
--  · context_surcharge_per_10k: el precio base cubre los primeros 32k de
--    contexto; cada banda extra de 10k suma esas requests. Sin esto un
--    Max (200k de cap) pagaría lo mismo que un Pro (32k) costándonos 6×.
--    Generaliza el recargo que ya existía hardcodeado para t/.
--
-- is_active = false a propósito: la key anterior devolvía 401 y
-- navy.zenllm.org ya no resuelve. Activar con el UPDATE del final cuando
-- haya key nueva + ZENLLM_BASE_URL=https://api.zenllm.org/v1 en LOS DOS
-- nodos (secret de Cloudflare y .env.local del PC).
-- ============================================================

ALTER TABLE models
  ADD COLUMN IF NOT EXISTS payg_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS context_surcharge_per_10k NUMERIC(6,3) NOT NULL DEFAULT 0;

COMMENT ON COLUMN models.payg_only IS
  'Modelo servido SOLO en billing_mode=payg (per-token). El pool de premium requests no puede absorber su coste upstream.';
COMMENT ON COLUMN models.context_surcharge_per_10k IS
  'Premium requests extra por cada 10k de contexto sobre 32k. 0 = sin recargo (upstream de cuota plana).';

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output, cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, context_surcharge_per_10k,
  payg_only, payg_credits_per_m_input, payg_credits_per_m_output,
  context_length, capabilities
) VALUES
  ('z/claude-fable-5', 'zenllm', 'claude-fable-5', 'Claude Fable 5', 3, 15, 0.3, 0, 1.5500, false, 40.00, 9.281, true, 33000, 165000, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/claude-fable-5.1', 'zenllm', 'claude-fable-5.1', 'Claude Fable 5.1', 3, 15, 0.075, 0, 1.5500, false, 40.00, 9.281, true, 33000, 165000, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/claude-opus-4.8', 'zenllm', 'claude-opus-4.8', 'Claude Opus 4.8', 1.5, 7.5, 0.15, 0, 1.5500, false, 20.00, 4.641, true, 16500, 82500, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/claude-opus-4.7', 'zenllm', 'claude-opus-4.7', 'Claude Opus 4.7', 0.75, 3.75, 0.075, 0, 1.5500, false, 10.00, 2.320, true, 8250, 41250, 1000000, '["tool_calling","streaming","system_message","vision"]'::jsonb),
  ('z/claude-opus-4.6', 'zenllm', 'claude-opus-4.6', 'Claude Opus 4.6', 1, 5, 0.1, 0, 1.5500, false, 14.00, 3.094, true, 11000, 55000, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/claude-sonnet-5', 'zenllm', 'claude-sonnet-5', 'Claude Sonnet 5', 0.5, 2.5, 0.05, 0, 1.5500, false, 7.00, 1.547, false, 5500, 27500, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/claude-sonnet-4.6', 'zenllm', 'claude-sonnet-4.6', 'Claude Sonnet 4.6', 0.45, 2.25, 0.045, 0, 1.5500, false, 6.00, 1.392, false, 4950, 24750, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/gpt-6-astra', 'zenllm', 'gpt-6-astra', 'GPT-6 Astra', 1, 5, 0.1, 0, 1.5500, false, 14.00, 3.094, true, 11000, 55000, 1050000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/gpt-5.6-terra', 'zenllm', 'gpt-5.6-terra', 'GPT-5.6 Terra', 0.4, 2.4, 0.04, 0, 1.5500, false, 6.00, 1.238, false, 4400, 26400, 1050000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/gpt-5.6-sol', 'zenllm', 'gpt-5.6-sol', 'GPT-5.6 Sol', 0.4, 2, 0.04, 0, 1.5500, false, 6.00, 1.238, false, 4400, 22000, 1050000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/gpt-5.6-luna', 'zenllm', 'gpt-5.6-luna', 'GPT-5.6 Luna', 0.03, 0.18, 0.003, 0, 1.5500, false, 1.00, 0.093, false, 330, 1980, 1050000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/gemini-3.1-pro', 'zenllm', 'gemini-3.1-pro', 'Gemini 3.1 Pro', 0.3, 1.8, 0.03, 0, 1.5500, false, 5.00, 0.928, false, 3300, 19800, 1048576, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/gemini-3.7-flash', 'zenllm', 'gemini-3.7-flash', 'Gemini 3.7 Flash', 0.15, 0.75, 0.015, 0, 1.5500, false, 2.00, 0.464, false, 1650, 8250, 1048576, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb)
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
  context_surcharge_per_10k = EXCLUDED.context_surcharge_per_10k,
  payg_only                 = EXCLUDED.payg_only,
  payg_credits_per_m_input  = EXCLUDED.payg_credits_per_m_input,
  payg_credits_per_m_output = EXCLUDED.payg_credits_per_m_output,
  context_length            = EXCLUDED.context_length,
  capabilities              = EXCLUDED.capabilities;

-- Modelos z/ del catálogo viejo que ZenLLM ya no sirve.
UPDATE models SET is_active = false
WHERE provider = 'zenllm' AND id NOT IN ('z/claude-fable-5', 'z/claude-fable-5.1', 'z/claude-opus-4.8', 'z/claude-opus-4.7', 'z/claude-opus-4.6', 'z/claude-sonnet-5', 'z/claude-sonnet-4.6', 'z/gpt-6-astra', 'z/gpt-5.6-terra', 'z/gpt-5.6-sol', 'z/gpt-5.6-luna', 'z/gemini-3.1-pro', 'z/gemini-3.7-flash');

-- Activar cuando la key nueva esté cargada en ambos nodos:
--   UPDATE models SET is_active = true WHERE provider = 'zenllm' AND id IN (
--     'z/claude-fable-5', 'z/claude-fable-5.1', 'z/claude-opus-4.8', 'z/claude-opus-4.7', 'z/claude-opus-4.6', 'z/claude-sonnet-5', 'z/claude-sonnet-4.6', 'z/gpt-6-astra', 'z/gpt-5.6-terra', 'z/gpt-5.6-sol', 'z/gpt-5.6-luna', 'z/gemini-3.1-pro', 'z/gemini-3.7-flash'
--   );
