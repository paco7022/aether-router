-- ============================================================
-- ZenLLM (z/) — reprecio: el descuento se RECORTÓ
-- 2026-09-07
--
-- El descuento del 5-sep no era estable. Comparando /v1/models autenticado
-- del 5-sep contra el de hoy, ZenLLM subió TODOS los precios de nuestra key
-- entre ×3,3 y ×10:
--   opus-4.8   $0.30 -> $0.99/M     opus-4.6  $0.07 -> $0.34/M
--   opus-4.7   $0.075 -> $0.495/M   sonnet-5  $0.05 -> $0.195/M
--   fable-5, fable-5.1, gpt-6-astra y minimax-m3 quedaron a TARIFA PÚBLICA
--   (descuento cero); el resto ronda el 34% de descuento, no el 90%.
--
-- Consecuencia mientras estuvo mal: entre el 5 y el 7 de septiembre servimos
-- 401 requests que nos costaron $6.22 y por las que ingresamos $1.74 — el 28%
-- del coste. Cuadra con el saldo real de la cuenta ($10 -> $3).
--
-- Se recalcula con la tarifa de hoy, misma fórmula y mismo suelo de 2 requests
-- en Claude Opus/Sonnet, y vuelve payg_only a todo lo que pasa de 6 requests
-- (Fable 5/5.1 a 40, Opus 4.8 y gpt-6-astra a 14, Opus 4.7 a 7): el pool diario
-- no puede absorber eso.
--
-- LECCIÓN: los precios de este proveedor se mueven sin aviso y su API no
-- expone gasto. Re-verificar `/v1/models` con auth ANTES de fiarse del coste
-- y vigilar con scripts/upstream-cost-report.mjs.
-- ============================================================

UPDATE models AS m SET
  cost_per_m_input          = v.cin,
  cost_per_m_output         = v.cout,
  cost_per_m_cache_read     = v.cache,
  premium_request_cost      = v.req,
  context_surcharge_per_10k = v.band,
  payg_only                 = v.payg_only,
  payg_credits_per_m_input  = v.pin,
  payg_credits_per_m_output = v.pout
FROM (VALUES
  ('z/claude-fable-5', 3, 15, 0.3, 40.00, 9.281, true, 33000, 165000),
  ('z/claude-fable-5.1', 3, 15, 0.075, 40.00, 9.281, true, 33000, 165000),
  ('z/claude-opus-4.8', 0.99, 4.95, 0.099, 14.00, 3.063, true, 10890, 54450),
  ('z/claude-opus-4.7', 0.495, 2.475, 0.0495, 7.00, 1.531, true, 5445, 27225),
  ('z/claude-opus-4.6', 0.34, 1.7, 0.034, 5.00, 1.052, false, 3740, 18700),
  ('z/claude-sonnet-5', 0.195, 0.975, 0.0195, 3.00, 0.603, false, 2145, 10725),
  ('z/claude-sonnet-4.6', 0.297, 1.485, 0.0297, 4.00, 0.919, false, 3267, 16335),
  ('z/gpt-6-astra', 1, 5, 0.1, 14.00, 3.094, true, 11000, 55000),
  ('z/gpt-5.6-terra', 0.196, 1.176, 0.0196, 3.00, 0.606, false, 2156, 12936),
  ('z/gpt-5.6-sol', 0.196, 0.98, 0.0196, 3.00, 0.606, false, 2156, 10780),
  ('z/gpt-5.6-luna', 0.0198, 0.1188, 0.00198, 1.00, 0.061, false, 218, 1307),
  ('z/gemini-3.1-pro', 0.198, 1.188, 0.0198, 3.00, 0.613, false, 2178, 13068),
  ('z/gemini-3.7-flash', 0.0735, 0.3675, 0.00735, 1.00, 0.227, false, 809, 4043),
  ('z/kimi-k3', 0.297, 1.485, 0.0297, 4.00, 0.919, false, 3267, 16335),
  ('z/glm-5.3', 0.1386, 0.4356, 0.01386, 2.00, 0.429, false, 1525, 4792),
  ('z/grok-4.3', 0.140296, 0.279604, 0.022724, 2.00, 0.434, false, 1543, 3076),
  ('z/kimi-k2.7-code', 0.06534, 0.3366, 0.01584, 1.00, 0.202, false, 719, 3703),
  ('z/minimax-m3', 0.04, 0.16, 0.008, 1.00, 0.124, false, 440, 1760),
  ('z/glm-5.3-flash', 0.007425, 0.02475, 0.001485, 1.00, 0.023, false, 82, 272)) AS v(id, cin, cout, cache, req, band, payg_only, pin, pout)
WHERE m.id = v.id;
