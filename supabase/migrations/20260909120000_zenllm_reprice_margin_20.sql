-- ============================================================
-- ZenLLM (z/) — tercera tarifa en cinco días + margen a 20%
-- 2026-09-09
--
-- Tercer cambio de precio de este proveedor desde el 5-sep. Esta vez Claude
-- perdió el descuento POR COMPLETO y además subieron su tarifa pública:
--
--   modelo            5-sep    7-sep    HOY    publico hoy
--   opus-4.6/4.7/4.8  0.07-0.30  0.34-0.99  2.50   2.50  (era 1.00-1.50)
--   sonnet-4.6        0.045    0.297    1.50   1.50  (era 0.45)
--   sonnet-5          0.05     0.195    1.00   1.00  (era 0.50)
--   fable-5/5.1       0.60-0.90  3.00     5.00   5.00  (era 3.00)
--
-- Los NO-Claude (gemini, glm, grok, kimi, minimax) mantienen su descuento
-- intacto; gpt-5.6 subió un 2%. O sea: el descuento que queda es solo para
-- lo que no es Claude.
--
-- MARGEN SUBIDO A 1,20 (petición del owner, "por cualquier cosa"): con un
-- proveedor que mueve precios tres veces en cinco días sin avisar y sin
-- endpoint de gasto, el 10% no daba colchón para detectar el cambio antes de
-- perder dinero. Afecta a premium_request_cost, al recargo por contexto y a
-- las tarifas PAYG.
--
-- CONSECUENCIA: todo Claude en z/ pasa a payg_only (Fable 73 req, Opus 37,
-- Sonnet 4.6 22, Sonnet 5 15) junto a gpt-6-astra (15). A esos precios z/ ya
-- no compite en modo request con t/, or/, bl/ y k/, que sirven Claude a 6 por
-- cuota plana. Queda utilizable per-token, donde cada token lleva su margen.
--
-- Balance del episodio (696 requests desde el 5-sep, tarifa de cada tramo):
-- coste ~$7,57, ingreso $5,33, neto -$2,24. Casi todo el agujero es del 5 al
-- 7, cuando el catálogo tenía los precios de lanzamiento; despues del reprecio
-- del 7 las 295 requests siguientes costaron $1,35 e ingresaron $3,59.
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
  ('z/claude-fable-5', 5, 25, 0.5, 73.00, 16.875, true, 60000, 300000),
  ('z/claude-fable-5.1', 5, 25, 0.125, 73.00, 16.875, true, 60000, 300000),
  ('z/claude-opus-4.8', 2.5, 12.5, 0.25, 37.00, 8.438, true, 30000, 150000),
  ('z/claude-opus-4.7', 2.5, 12.5, 0.25, 37.00, 8.438, true, 30000, 150000),
  ('z/claude-opus-4.6', 2.5, 12.5, 0.25, 37.00, 8.438, true, 30000, 150000),
  ('z/claude-sonnet-5', 1, 5, 0.1, 15.00, 3.375, true, 12000, 60000),
  ('z/claude-sonnet-4.6', 1.5, 7.5, 0.15, 22.00, 5.062, true, 18000, 90000),
  ('z/gpt-6-astra', 1, 5, 0.1, 15.00, 3.375, true, 12000, 60000),
  ('z/gpt-5.6-terra', 0.2, 1.2, 0.02, 4.00, 0.675, false, 2400, 14400),
  ('z/gpt-5.6-sol', 0.2, 1, 0.02, 3.00, 0.675, false, 2400, 12000),
  ('z/gpt-5.6-luna', 0.02, 0.12, 0.002, 1.00, 0.068, false, 240, 1440),
  ('z/gemini-3.1-pro', 0.198, 1.188, 0.0198, 3.00, 0.668, false, 2376, 14256),
  ('z/gemini-3.7-flash', 0.0735, 0.3675, 0.00735, 2.00, 0.248, false, 882, 4410),
  ('z/kimi-k3', 0.297, 1.485, 0.0297, 5.00, 1.002, false, 3564, 17820),
  ('z/glm-5.3', 0.1386, 0.4356, 0.01386, 2.00, 0.468, false, 1663, 5227),
  ('z/grok-4.3', 0.140296, 0.279604, 0.022724, 2.00, 0.473, false, 1684, 3355),
  ('z/kimi-k2.7-code', 0.06534, 0.3366, 0.01584, 1.00, 0.221, false, 784, 4039),
  ('z/minimax-m3', 0.04, 0.16, 0.008, 1.00, 0.135, false, 480, 1920),
  ('z/glm-5.3-flash', 0.007425, 0.02475, 0.001485, 1.00, 0.025, false, 89, 297)) AS v(id, cin, cout, cache, req, band, payg_only, pin, pout)
WHERE m.id = v.id;
