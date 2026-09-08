-- Cierra la tabla `models` a service_role.
--
-- Desde 001_initial_schema.sql la tabla arrastraba una policy pública:
--   CREATE POLICY "Anyone can view active models" ON models FOR SELECT USING (is_active = true);
--
-- La anon key viaja en el bundle del browser, así que cualquiera podía leer
-- todas las filas activas directo de PostgREST: `provider`, `upstream_model_id`,
-- `cost_per_m_input/output`, `margin`, `premium_request_cost` y las tarifas
-- payg. Eso es el costo real upstream, el margen y la cadena completa de
-- resellers — legible por quien abra devtools.
--
-- Ya ningún camino de la app necesita leer la tabla con la sesión del usuario:
-- el catálogo público sale por /api/v1/models y las páginas del dashboard usan
-- createAdminClient(). El REVOKE es lo que corta de verdad la lectura: borrar
-- solo la policy dejaría la tabla accesible si RLS llegara a desactivarse.

DROP POLICY IF EXISTS "Anyone can view active models" ON public.models;

REVOKE SELECT ON TABLE public.models FROM anon, authenticated;

-- INSERT/UPDATE/DELETE ya se habían revocado en 055_security_audit_fixes.sql;
-- se repiten acá para que este archivo describa por sí solo el estado final.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.models FROM anon, authenticated;

GRANT ALL ON TABLE public.models TO service_role;
