-- ============================================================
-- ZenLLM (z/) — reprecio por descuento de cuenta
-- 2026-09-05
--
-- ZenLLM aplicó un descuento a NUESTRA key. Verificado comparando
-- api.zenllm.org/v1/models autenticado contra el público sin auth: 21 de los
-- 30 modelos bajan de precio, la mayoría ÷10 (opus-4.6 ÷14,3; opus-4.8, fable-5
-- y minimax ÷5; fable-5.1 y gemini-3-6-flash ÷3,3). Los precios de abajo son
-- los que ve nuestra key, o sea nuestro coste real.
--
-- Misma fórmula de siempre (ver 20260905120000): plan Pro a $0.003556 por
-- premium request, referencia 32.768 tok input + 2.000 output, margen ×1,10.
--
-- SUELO DE SEGURIDAD (decisión del owner): Claude Opus y Sonnet nunca bajan de
-- 2 premium requests aunque la fórmula dé 1. Motivos: (a) si el descuento es
-- promocional y lo revierten, 2 amortigua la pérdida mientras lo detectamos —
-- no hay endpoint de gasto en su API para vigilarlo automáticamente; (b) a 1
-- request TODO el tráfico Claude de la plataforma (hoy a 6 en t/, or/, bl/, k/)
-- saltaría de golpe a un provider cuyo VPS se cayó dos veces el mismo día.
-- A 2 sigue siendo, con diferencia, el Claude más barato del catálogo.
-- Opus 4.8 se queda en el 4 de la fórmula: el suelo solo sube precios, nunca
-- los baja.
--
-- payg_only se APAGA en los 6 que lo tenían (Opus 4.6/4.7/4.8, gpt-6-astra,
-- Fable 5/5.1): con el descuento caen a 2-12 requests, cifras que el pool sí
-- absorbe. Ya no hay motivo para restringirlos a per-token. Las columnas PAYG
-- se mantienen actualizadas para quien use ese modo.
-- ============================================================

UPDATE models AS m SET
  cost_per_m_input          = v.cin,
  cost_per_m_output         = v.cout,
  cost_per_m_cache_read     = v.cache,
  premium_request_cost      = v.req,
  context_surcharge_per_10k = v.band,
  payg_credits_per_m_input  = v.pin,
  payg_credits_per_m_output = v.pout,
  payg_only                 = false
FROM (VALUES
  ('z/claude-fable-5', 0.6, 3, 0.06, 8.00, 1.856, 6600, 33000),
  ('z/claude-fable-5.1', 0.9, 4.5, 0.0225, 12.00, 2.784, 9900, 49500),
  ('z/claude-opus-4.8', 0.3, 1.5, 0.03, 4.00, 0.928, 3300, 16500),
  ('z/claude-opus-4.7', 0.075, 0.375, 0.0075, 2.00, 0.232, 825, 4125),
  ('z/claude-opus-4.6', 0.07, 0.35, 0.007, 2.00, 0.217, 770, 3850),
  ('z/claude-sonnet-5', 0.05, 0.25, 0.005, 2.00, 0.155, 550, 2750),
  ('z/claude-sonnet-4.6', 0.045, 0.225, 0.0045, 2.00, 0.139, 495, 2475),
  ('z/gpt-6-astra', 0.1, 0.5, 0.01, 2.00, 0.309, 1100, 5500),
  ('z/gpt-5.6-terra', 0.04, 0.24, 0.004, 1.00, 0.124, 440, 2640),
  ('z/gpt-5.6-sol', 0.04, 0.2, 0.004, 1.00, 0.124, 440, 2200),
  ('z/gpt-5.6-luna', 0.003, 0.018, 0.0003, 1.00, 0.009, 33, 198),
  ('z/gemini-3.1-pro', 0.03, 0.18, 0.003, 1.00, 0.093, 330, 1980),
  ('z/gemini-3.7-flash', 0.015, 0.075, 0.0015, 1.00, 0.046, 165, 825),
  ('z/kimi-k3', 0.045, 0.225, 0.0045, 1.00, 0.139, 495, 2475),
  ('z/glm-5.3', 0.021, 0.066, 0.0021, 1.00, 0.065, 231, 726),
  ('z/grok-4.3', 0.01846, 0.03679, 0.00299, 1.00, 0.057, 203, 405),
  ('z/kimi-k2.7-code', 0.0099, 0.051, 0.0024, 1.00, 0.031, 109, 561),
  ('z/minimax-m3', 0.008, 0.032, 0.0016, 1.00, 0.025, 88, 352),
  ('z/glm-5.3-flash', 0.001125, 0.00375, 0.000225, 1.00, 0.003, 12, 41)) AS v(id, cin, cout, cache, req, band, pin, pout)
WHERE m.id = v.id;
