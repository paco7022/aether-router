-- ============================================================
-- ZenLLM (z/) — GLM, Kimi, Grok y MiniMax
-- 2026-09-05
--
-- Segunda tanda del catálogo relanzado en 20260905120000. Misma fórmula
-- (ver esa migración): precio contra el plan Pro ($0.003556 por premium
-- request), request de referencia 32.768 tok input + 2.000 output, margen
-- ×1,10. Precios verificados contra api.zenllm.org/v1/models.
--
-- Ninguno pasa de 6 premium requests, así que todos entran en modo request
-- Y en PAYG: no hace falta payg_only aquí (eso era para Opus/Fable, que se
-- iban a 20-40 requests por llamada).
--
-- Todos llevan context_surcharge_per_10k porque el upstream nos factura por
-- token: el precio base cubre los primeros 32k y cada banda de 10k extra
-- suma su parte. Ese mismo campo es el que hace que el overage (la request
-- extra pasado el cap diario) cobre por coste real en vez de 100 planos.
--
-- is_active = false: al sembrarlos el gateway de ZenLLM estaba caído entero
-- (HTTP 530 / Cloudflare 1033 en TODOS los modelos, incluido /v1/models), así
-- que no se pudo verificar que el upstream los sirva de verdad. Activar con:
--   UPDATE models SET is_active = true WHERE provider='zenllm' AND id IN (
--     'z/kimi-k3','z/glm-5.3','z/grok-4.3','z/kimi-k2.7-code',
--     'z/minimax-m3','z/glm-5.3-flash');
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output, cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, context_surcharge_per_10k,
  payg_only, payg_credits_per_m_input, payg_credits_per_m_output,
  context_length, capabilities
) VALUES
  ('z/kimi-k3',        'zenllm', 'kimi-k3',        'Kimi K3',        0.45,    2.25,   0.045,   0, 1.5500, false, 6.00, 1.392, false, 4950, 24750, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/glm-5.3',        'zenllm', 'glm-5.3',        'GLM 5.3',        0.21,    0.66,   0.021,   0, 1.5500, false, 3.00, 0.650, false, 2310,  7260, 1000000, '["tool_calling","streaming","system_message","reasoning","json_mode"]'::jsonb),
  ('z/grok-4.3',       'zenllm', 'grok-4.3',       'Grok 4.3',       0.1846,  0.3679, 0.0299,  0, 1.5500, false, 3.00, 0.571, false, 2031,  4047, 1000000, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/kimi-k2.7-code', 'zenllm', 'kimi-k2.7-code', 'Kimi K2.7 Code', 0.099,   0.51,   0.024,   0, 1.5500, false, 2.00, 0.306, false, 1089,  5610,  262144, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb),
  ('z/minimax-m3',     'zenllm', 'minimax-m3',     'MiniMax M3',     0.04,    0.16,   0.008,   0, 1.5500, false, 1.00, 0.124, false,  440,  1760,  200000, '["tool_calling","streaming","system_message"]'::jsonb),
  ('z/glm-5.3-flash',  'zenllm', 'glm-5.3-flash',  'GLM 5.3 Flash',  0.01125, 0.0375, 0.00225, 0, 1.5500, false, 1.00, 0.035, false,  124,   413, 1048576, '["tool_calling","streaming","system_message","vision","reasoning","json_mode"]'::jsonb)
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
