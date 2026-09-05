-- ============================================================
-- models.cost_per_m_* — de 4 a 10 decimales
-- 2026-09-05
--
-- Eran NUMERIC(10,4). Suficiente cuando el proveedor más barato cobraba
-- céntimos por millón, pero no con el descuento de ZenLLM: glm-5.3-flash
-- cuesta $0.001125/M input y $0.00375/M output, y la columna los guardaba
-- como 0.0011 y 0.0038 (-2,2% y +1,3%).
--
-- En absoluto son millonésimas de dólar, pero el redondeo está en la TARIFA,
-- así que se propaga a cada fila de usage_logs.upstream_cost_usd y descuadra
-- la auditoría contra la factura del proveedor — que es justo para lo que se
-- añadió esa columna (ver 20260905160000). Verificado tras el cambio: una
-- request de 14 in / 300 out loguea 0.0000011407 contra 0.0000011408 exacto.
--
-- Ampliar la escala no toca ningún valor existente.
-- ============================================================

ALTER TABLE public.models
  ALTER COLUMN cost_per_m_input       TYPE NUMERIC(14,10),
  ALTER COLUMN cost_per_m_output      TYPE NUMERIC(14,10),
  ALTER COLUMN cost_per_m_cache_read  TYPE NUMERIC(14,10),
  ALTER COLUMN cost_per_m_cache_write TYPE NUMERIC(14,10);

-- Reescribir los z/ con el precio exacto que declara su API: los que tenían
-- más de 4 decimales se habían guardado ya redondeados.
UPDATE models AS m SET
  cost_per_m_input      = v.cin,
  cost_per_m_output     = v.cout,
  cost_per_m_cache_read = v.cache
FROM (VALUES
  ('z/claude-fable-5',    0.6,      3.0,      0.06),
  ('z/claude-fable-5.1',  0.9,      4.5,      0.0225),
  ('z/claude-opus-4.8',   0.3,      1.5,      0.03),
  ('z/claude-opus-4.7',   0.075,    0.375,    0.0075),
  ('z/claude-opus-4.6',   0.07,     0.35,     0.007),
  ('z/claude-sonnet-5',   0.05,     0.25,     0.005),
  ('z/claude-sonnet-4.6', 0.045,    0.225,    0.0045),
  ('z/gpt-6-astra',       0.1,      0.5,      0.01),
  ('z/gpt-5.6-terra',     0.04,     0.24,     0.004),
  ('z/gpt-5.6-sol',       0.04,     0.2,      0.004),
  ('z/gpt-5.6-luna',      0.003,    0.018,    0.0003),
  ('z/gemini-3.1-pro',    0.03,     0.18,     0.003),
  ('z/gemini-3.7-flash',  0.015,    0.075,    0.0015),
  ('z/kimi-k3',           0.045,    0.225,    0.0045),
  ('z/glm-5.3',           0.021,    0.066,    0.0021),
  ('z/grok-4.3',          0.01846,  0.03679,  0.00299),
  ('z/kimi-k2.7-code',    0.0099,   0.051,    0.0024),
  ('z/minimax-m3',        0.008,    0.032,    0.0016),
  ('z/glm-5.3-flash',     0.001125, 0.00375,  0.000225)
) AS v(id, cin, cout, cache)
WHERE m.id = v.id;
