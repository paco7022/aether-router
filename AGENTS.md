# Aether Router Agent Guide

Guia rapida para agentes que trabajen en este repo. Lee esto antes de abrir medio proyecto: aqui esta el mapa mental, los archivos importantes y como verificar cambios.

## Proyecto

Aether Router es una app Next.js App Router que combina:

- Dashboard web para usuarios.
- API OpenAI-compatible en `/api/v1`.
- Billing/creditos con Stripe + Supabase.
- Routing hacia providers externos de modelos.
- Chat interno del dashboard que reutiliza la misma ruta de billing que la API publica.

Stack principal:

- Next.js 16, React 19, TypeScript.
- Supabase Auth, Postgres, Storage y RPCs SQL.
- Stripe para suscripciones y compras de creditos.
- Vitest para tests unitarios.
- Cloudflare Workers/OpenNext como destino de migracion desde Vercel.

## Comandos

Desde `aether-router/`:

```bash
npm test
npm run build
npm run dev
npm run build:cf:docker
npm run deploy:cf
npm run cf-typegen
```

Regla practica:

- Antes de terminar cambios de backend/API: corre `npm test` y `npm run build`.
- Antes de tocar deploy Cloudflare: corre `npm run build` y luego genera `.open-next` con `npm run build:cf:docker` en Windows.
- Para publicar la app Next ya construida en Cloudflare usa `npm run deploy:cf`.
- En Linux/WSL con Node 22 puedes usar `npm run deploy:cf:full`.
- Para publicar solo el worker edge usa `npx wrangler deploy --config cf-worker/wrangler.toml`.
- Si agregas o cambias SQL: crea migracion con `supabase migration new nombre_descriptivo`.
- La base local puede no estar corriendo; si falla `supabase migration list --local` por `127.0.0.1:54322`, reportalo como pendiente operativo.

## Migracion Cloudflare

Contexto actual: Vercel dejo de ser suficiente por alto uso. El proyecto se esta moviendo a Cloudflare sin romper el servicio existente.

Piezas ya presentes:

- `@opennextjs/cloudflare` y `wrangler` en devDependencies.
- `open-next.config.ts` con `defineCloudflareConfig()`.
- `next.config.ts` inicializa OpenNext Cloudflare para dev.
- `wrangler.jsonc` publica la app Next como `aether-router-app`.
- `cf-worker/` contiene un Worker separado `aether-router-edge` que dirige trafico entre PC y cloud.
- `wrangler.jsonc` registra `router-cloud.aether-ai.dev` como custom domain de la app Cloudflare.
- `cf-worker/wrangler.toml` usa `CLOUD_ORIGIN = "https://router-cloud.aether-ai.dev"` para enviar webhooks y fallback cloud a la app Next en Cloudflare.
- El Worker edge acepta la URL publica `https://api.aether-ai.dev/v1` y normaliza `/v1/*` hacia `/api/v1/*` en la app Next.
- CORS, preflight y rate limit publico viven en `cf-worker/src/worker.js`; se quito el proxy/middleware de Next porque OpenNext Cloudflare no soporta Node Middleware de Next 16.
- En Windows, OpenNext + Turbopack genero `ChunkLoadError` en runtime y OpenNext + Webpack fallo bajo Node 24. La ruta estable usada para deploy es Docker con Node 22: `npm run build:cf:docker` y luego `npm run deploy:cf`.
- Stripe SDK en Workers (2026-05-21): con `nodejs_compat` el SDK resuelve a su build de Node y usa el transporte `https` de Node, que se cuelga en workerd (checkout/portal nunca resuelven, el front queda en "Redirecting..."). `src/lib/stripe.ts` fuerza `httpClient: Stripe.createFetchHttpClient()`. El webhook usa `constructEventAsync()` + `Stripe.createSubtleCryptoProvider()` porque el `constructEvent` sincrono depende de crypto sincrono no disponible en workerd. NO revertir a las versiones sincronas/Node.
- Gotcha de deploy (2026-05-21): `initOpenNextCloudflareForDev()` en `next.config.ts` debe quedar detras de `if (process.env.NODE_ENV === "development")`. Sin ese guard, el `next start` del PC (PM2 `aether-router`) spawnea un workerd hijo que mantiene un lock sobre `.open-next/assets`; como el build Docker bind-montea el repo, ese lock del host hace fallar `opennextjs-cloudflare build` con `EACCES rmdir .open-next/assets`. Si vuelve a pasar: `pm2 stop aether-router`, borrar `.open-next`, rebuild, `pm2 start aether-router` (el fallback cloud cubre el tráfico de API mientras el PC esta abajo).

MCP Cloudflare instalado en el workspace:

- `cloudflare-api`: `https://mcp.cloudflare.com/mcp`
- `cloudflare-docs`: `https://docs.mcp.cloudflare.com/mcp`
- `cloudflare-bindings`: `https://bindings.mcp.cloudflare.com/mcp`
- `cloudflare-builds`: `https://builds.mcp.cloudflare.com/mcp`
- `cloudflare-observability`: `https://observability.mcp.cloudflare.com/mcp`

Estan registrados en `../.mcp.json` y `../.codex/config.toml`. El servidor `cloudflare-api` puede pedir OAuth de Cloudflare al conectar; no hardcodees tokens en el repo. Usa los MCP para consultar docs actuales, revisar builds/logs y ejecutar cambios de cuenta cuando el cliente este autorizado.

MCP Supabase instalado:

- `supabase`: `https://mcp.supabase.com/mcp?project_ref=ozzcklahznktivmkudbr`
- Registrado en `.mcp.json`, `../.mcp.json` y `../.codex/config.toml`.
- El servidor responde 401 sin sesion, que es esperado; el siguiente paso es autenticar el MCP por OAuth desde el cliente Codex/Claude y recargar herramientas.
- El repo ya usa `@supabase/supabase-js` y `@supabase/ssr`; los helpers viven en `src/lib/supabase/`.
- Los helpers aceptan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y hacen fallback a `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Estado de deploy actual:

1. `aether-router-app` desplegado en `https://router-cloud.aether-ai.dev`.
2. Secrets de runtime cargados en `aether-router-app` desde `.env.local`.
3. `aether-router-edge` desplegado en `api.aether-ai.dev/*`.
4. Verificado: `https://router-cloud.aether-ai.dev/` responde 200.
5. Verificado: `https://api.aether-ai.dev/v1/models` responde 200 y mantiene CORS publico.
6. Verificado: `https://api.aether-ai.dev/v1/webhooks/stripe` se pinnea a cloud y responde `Missing signature` sin firma.
7. Verificado: `/auth/callback` redirige siempre al dominio canonico `router-cloud.aether-ai.dev`.
8. Verificado: Supabase Auth acepta `redirect_to=https://router-cloud.aether-ai.dev/auth/callback` para Google OAuth.
9. Hecho (2026-05-21): el webhook endpoint live de Stripe `we_1THZM4ArDEeywfgWIM7fDm7Q` se reapunto de `https://aether-router.vercel.app/api/v1/webhooks/stripe` a `https://api.aether-ai.dev/v1/webhooks/stripe`. Se actualizo solo la URL (mismo `id` y signing secret), asi que `STRIPE_WEBHOOK_SECRET` no cambia. Eventos suscritos sin cambios: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Cuenta Stripe: AetherAI Studio (`acct_1SViSkArDEeywfgW`).

Uso free actual:

- El unico uso incluido gratis es el pool diario de requests premium del plan `free`: `gm_daily_requests = 15`.
- El plan `free` no debe recibir creditos diarios: `credits_per_day = 0` y `credits_per_month = 0`.
- En Cloudflare, `AETHER_FREE_INCLUDED_USAGE_ENABLED=true` reactiva ese pool premium diario.
- En Cloudflare, `AETHER_FREE_PROMOS_ENABLED=false` mantiene apagados free events, pools de tokens y modelos cero-costo promocionales.
- Si cambias esto, actualiza tambien `wrangler.jsonc`, `.env.local.example`, UI de Billing/Models y una migracion Supabase.

Pendiente operativo:

- Aplicar la migracion `20260520200947_reactivate_free_premium_requests.sql` en el proyecto Supabase real (`ozzcklahznktivmkudbr`). El CLI local esta enlazado a `vuwejfaojstxleylynro`, asi que `supabase db push --linked` no aplica al proyecto de la app.
- Si se usan emails/magic links de Supabase, revisar en Dashboard > Authentication > URL Configuration que el Site URL sea `https://router-cloud.aether-ai.dev` y que Redirect URLs incluya `https://router-cloud.aether-ai.dev/auth/callback`.
- Si se quiere apagar el fallback Vercel por completo, revisar proveedores externos/clientes que aun tengan una URL vieja guardada fuera del repo.

## Estructura

```text
src/app/
  page.tsx                         Landing/home.
  layout.tsx                       Layout global.
  login, register, policies/       Paginas publicas.
  dashboard/                       UI autenticada.
  api/v1/                          API publica y endpoints de cuenta/billing.
  api/dashboard/chat/              API interna del chat del dashboard.

src/components/                    Componentes de dashboard/UI.
src/components/chat/               Render de mensajes, artefactos y codigo.

src/lib/
  auth.ts                          API keys, sesiones y shape ApiKeyInfo.
  credits.ts                       Calculo de creditos/costos.
  csrf.ts                          Proteccion CSRF para rutas con cookies.
  chat-preflight.ts                Helpers de preflight para chat/API.
  content-moderation.ts            Moderacion CSAM y auto-ban.
  claude-block.ts                  Politicas especiales para modelos Claude.
  preset.ts, builtinPresets.ts     Presets de prompt del usuario/sistema.
  pc-failover.ts                   Failover a PC/origen externo.
  providers/                       Adaptadores a upstreams.
  supabase/                        Clientes Supabase browser/server/admin.

supabase/migrations/               Historial de schema/RPC/policies.
tests/                             Tests Vitest.
cf-worker/                         Worker separado.
wrangler.jsonc                     Worker OpenNext de la app Next en Cloudflare.
open-next.config.ts                Configuracion OpenNext Cloudflare.
```

## Archivos Criticos

### API principal de modelos

`src/app/api/v1/chat/completions/route.ts`

Es el corazon del proyecto. Hace:

- Lee y limita tamano del body.
- Intenta failover a PC si aplica.
- Autentica por Bearer API key o sesion Supabase.
- Aplica CSRF en flujo con cookies.
- Modera contenido.
- Busca modelo activo en Supabase.
- Aplica gates de plan, Claude, custom keys, free events, contexto y creditos.
- Reserva creditos/premium requests antes del upstream.
- Llama al provider.
- Hace accounting, refunds, usage logs y transactions en streaming/no-streaming.

Antes de tocarlo, ubica exactamente en que fase estas trabajando. Es facil romper billing por mover un check antes/despues de una reserva.

Orden mental del handler:

1. Body/failover.
2. Auth.
3. JSON/model/messages.
4. Moderacion.
5. Modelo/provider/politicas.
6. Free event/custom key/premium gates.
7. Reserva de creditos.
8. Forward al provider.
9. Streaming o respuesta normal.
10. Settlement/logs/refunds.

### Chat dashboard

`src/app/api/dashboard/chat/conversations/route.ts`

- Lista y crea conversaciones.

`src/app/api/dashboard/chat/conversations/[id]/route.ts`

- Lee, actualiza y borra conversaciones.

`src/app/api/dashboard/chat/conversations/[id]/stream/route.ts`

- Guarda mensaje de usuario.
- Inyecta historial.
- Convierte imagenes `storage:{path}` a data URLs.
- Llama internamente a `/api/v1/chat/completions` con cookies.
- Guarda respuesta del asistente.

`src/app/api/dashboard/chat/upload/route.ts`

- Uploads de imagenes del chat.
- Valida MIME declarado y magic bytes.
- Requiere conversacion propia.

### Supabase

`src/lib/supabase/server.ts`

- Cliente de sesion/cookies para Server Components y route handlers.

`src/lib/supabase/client.ts`

- Cliente browser.

`src/lib/supabase/admin.ts`

- Cliente service-role singleton. Bypassea RLS. Nunca importarlo en componentes cliente.

`supabase/migrations/`

- Toda columna/RPC/policy usada por el codigo debe existir aqui.
- Si el codigo inserta una columna nueva, agrega migracion idempotente con `ADD COLUMN IF NOT EXISTS`.
- Revisa RLS y grants cuando agregues tablas/RPCs.

### Auth, creditos y seguridad

`src/lib/auth.ts`

- `validateApiKey()` valida hash SHA-256 de API key y carga profile.
- `validateSession()` arma un `ApiKeyInfo` sintetico para el chat dashboard.
- Si agregas campos de perfil que el router necesita, actualiza ambas funciones.

`src/lib/csrf.ts`

- Rutas con cookies y mutacion deben llamar `requireCsrf(req)`.

`src/proxy.ts`

- CORS, rate limit simple por IP para endpoints publicos y redirect del dashboard.
- En Next 16 esto reemplaza a `middleware.ts`.

`src/lib/credits.ts`

- Formula de creditos y costos.
- Cambios aqui afectan billing global.

`src/lib/chat-preflight.ts`

- Helpers chicos y testeables para preflight.

`src/lib/ban.ts`

- Helpers de ban/fingerprint. Ya tiene tests.

### Providers

`src/lib/providers/types.ts`

- Interface Provider.
- Sets de provider premium/free/flat-rate. Mantenerlos sincronizados con los providers reales.

`src/lib/providers/index.ts`

- Registro central de providers.

Adaptadores:

- `trolllm.ts`
- `riftai.ts`
- `opencode.ts`
- `openrouter.ts`
- `dlab.ts`
- `hapuppy.ts`
- `gameron.ts`
- `webproxy.ts`
- `nano.ts`
- `shoot.ts`

Todos deben aceptar `signal?: AbortSignal` y pasarlo a `fetch`.

### Billing

`src/app/api/v1/billing/subscribe/route.ts`

- Checkout/portal de suscripciones.

`src/app/api/v1/billing/buy-credits/route.ts`

- Compra one-time de creditos.

`src/app/api/v1/billing/claim-daily/route.ts`

- Reclamo diario de creditos.

`src/app/api/v1/billing/claim-gm/route.ts`

- Reclamo de requests premium/GM.

`src/app/api/v1/webhooks/stripe/route.ts`

- Webhooks Stripe. Tiene dedupe/locks por evento.

`src/lib/stripe.ts`

- Cliente Stripe.

### Admin

`src/app/api/v1/admin/route.ts`

- Endpoint multiaccion para usuarios, planes, modelos, eventos, bans y custom keys.
- Todas las mutaciones deben tener `requireCsrf(req)` y `requireAdmin(req)`.
- Si agregas accion, valida input y no aceptes updates arbitrarios salvo whitelist.

`src/app/dashboard/admin/`

- UI admin.

`src/lib/admin.ts`

- Decide si un usuario es admin.

## Donde Editar Segun Tarea

- "Nuevo provider": `src/lib/providers/nuevo.ts`, `src/lib/providers/index.ts`, `src/lib/providers/types.ts`, migracion para rows en `models`.
- "Cambiar precio/modelo": normalmente migracion SQL en `supabase/migrations`; evita hardcode en TS si ya vive en tabla `models`.
- "Modelos r/ RiftAI": todos los rows `provider = 'riftai'` con id `r/%` deben costar `premium_request_cost = 1`.
- "Nuevo campo de perfil usado por routing": migracion + `src/lib/auth.ts` en `validateApiKey` y `validateSession`.
- "Bug de cobro o refund": empieza en `src/app/api/v1/chat/completions/route.ts`, busca reservation/settlement/refund.
- "Bug del chat web": revisa `src/app/api/dashboard/chat/...` y luego `chat/completions`.
- "CSRF/CORS/rate limit": `src/lib/csrf.ts` y `src/proxy.ts`.
- "Dashboard visual": `src/app/dashboard/...` y `src/components/...`.
- "Storage/imagenes": `src/app/api/dashboard/chat/upload/route.ts` y `[id]/stream/route.ts`.
- "Stripe": `billing/*`, `webhooks/stripe/route.ts`, `src/lib/stripe.ts`.

## Reglas Importantes

- No toques proyectos hermanos (`anti-api`, `geminicli2api`) si el pedido dice Aether Router.
- No uses service-role en cliente/browser.
- No confies en `user_metadata` para autorizacion.
- Rutas con cookies + mutacion: `requireCsrf(req)`.
- Para rutas con `req.json()`, captura JSON invalido y responde 400.
- En streaming, piensa en tres finales: complete, upstream error, client abort.
- Si reservas algo antes del upstream, debe haber refund en error/abort cuando corresponda.
- Evita mover validaciones despues de reservas si pueden fallar con 4xx.
- Si agregas una columna usada por inserts/selects, agrega migracion.
- Si cambias accounting, verifica tanto streaming como non-streaming.

## Tests Existentes

`tests/chat-preflight.test.ts`

- Auth header, fingerprint y errores de credito/preflight.

`tests/ban-auto-link.test.ts`

- Construccion de filas de ban por fingerprint/IP.

Si agregas helpers puros para billing, preflight, parsing SSE o bans, pon tests aqui. El handler grande no esta facil de testear directamente; extraer helper puro suele ser mejor que mockear todo Next/Supabase.

## Checklist Antes De Entregar

- `npm test`
- `npm run build`
- `git status --short` para ver archivos tocados.
- Si hubo SQL, mencionar migracion y si no se pudo validar contra DB local/remota.
- Si hubo cambios de API/billing, mencionar el flujo afectado: streaming, non-streaming, custom key, premium, free event, dashboard chat.

