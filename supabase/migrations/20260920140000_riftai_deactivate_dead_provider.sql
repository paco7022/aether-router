-- ============================================================
-- r/ RiftAI — apagado completo del proveedor (soft, reversible)
--
-- Motivo: RiftAI está caído al 100%. El 2026-09-20 se probaron los
-- 65 modelos de texto de su catálogo (POST /chat/completions real,
-- no solo GET /models) y respondieron 0. No es un modelo ni un tier:
-- se les cayeron las credenciales con todos los vendors a la vez, y
-- sus propios errores lo delatan:
--   Gemini      500  "Google has suspended our API"
--   DeepSeek    401  "Your api key: ****a826 is invalid"
--   GLM / Qwen  401  "Incorrect API key provided ... alibabacloud"
--   Claude      502  envolviendo 403 de AWS "The security token ... is invalid"
--   GPT         503  "Provider 'azure' is not available" / 401 sk-proj-...
--   Grok        403
-- Las dos keys de .env.local dan resultados idénticos => no es un
-- problema de nuestra cuenta ni de key, es del proveedor.
--
-- Impacto medido en usage_logs: última respuesta con tokens>0 el
-- 2026-08-21 (r/deepseek-v4-pro). Desde el 2026-08-22: 77 requests,
-- 0 exitosas, 9 usuarios distintos afectados en septiembre.
-- Nadie fue cobrado (0 filas con credits_charged>0): route.ts hace
-- refundReservation() en la rama !providerResponse.ok.
--
-- Soft-delete: las filas, su historial de uso y sus precios quedan
-- intactos. Para revivir el proveedor basta poner is_active=true en
-- los modelos que vuelvan a responder — pero re-verificar uno por uno
-- con un POST real antes, porque su GET /v1/models sigue listando 72
-- modelos tan tranquilo mientras el 100% falla.
--
-- OJO al revivir: 4 de estas filas ya NO existen upstream y no deben
-- reactivarse tal cual — r/glm-4.6 y r/glm-5v-turbo (que seguían
-- activas), más r/claude-opus-4-7 y r/gpt-5.5-pro (ya apagadas).
-- ============================================================

UPDATE models
   SET is_active = false
 WHERE provider = 'riftai'
   AND is_active = true;
