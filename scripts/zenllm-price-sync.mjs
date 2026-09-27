// zenllm-price-sync.mjs — sincroniza los precios de z/ (ZenLLM) en tiempo real.
//
//   node scripts/zenllm-price-sync.mjs --once --dry-run    -> ver qué cambiaría
//   node scripts/zenllm-price-sync.mjs --once              -> aplicar una vez
//   node scripts/zenllm-price-sync.mjs                     -> daemon, cada 30s
//
// POR QUÉ EXISTE: ZenLLM nos factura por token y mueve su tarifa sin avisar
// (opus-4.6 input: $0.07 el 5-sep -> $0.34 el 7-sep -> $2.50 el 9-sep). Cada
// vez que la mueve hacia arriba y nosotros no nos enteramos, vendemos bajo
// coste. Su `GET /v1/models` CON Authorization devuelve la tarifa real de
// NUESTRA cuenta (sin auth devuelve la pública, que es otra), así que es la
// fuente de verdad y se puede leer tan seguido como haga falta.
//
// QUÉ HACE cada ciclo:
//   1. Lee el catálogo de ZenLLM con la key.
//   2. Lee las filas z/ de la tabla `models`.
//   3. Recalcula con la fórmula de precios (margen 1.25) y hace PATCH SOLO de
//      lo que cambió. Si nada cambió no escribe nada.
//   4. Los modelos que desaparecen del catálogo upstream se desactivan
//      (is_active=false) y se reactivan solos si vuelven.
//   5. Los modelos nuevos del upstream se REPORTAN, nunca se dan de alta solos
//      (hace falta display_name, capabilities y decidir si se vende).
//
// GRANULARIDAD REAL: el router cachea la fila del modelo 60s por proceso
// (modelRowCache en chat/completions/route.ts), así que un cambio tarda hasta
// ~90s en cobrarse en los dos nodos. Pollear cada 30s mantiene la DB fresca;
// bajar de 30s no acelera el cobro.
//
// SEGURIDAD DE PRECIO: el precio de venta se DERIVA del suyo, así que nunca
// puede quedar por debajo de coste, ni cuando suben ni cuando bajan. Los
// únicos guards son contra payloads corruptos (catálogo vacío, precios no
// numéricos), no contra el precio en sí.
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(REPO, '.env.local');
const LOG_DIR = path.join(REPO, 'logs');
const LOG_PATH = path.join(LOG_DIR, 'zenllm-price-sync.jsonl');
const STATE_PATH = path.join(LOG_DIR, 'zenllm-price-sync.state.json');

// ---------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const ONCE = argv.includes('--once');
const DRY = argv.includes('--dry-run');
// Da de alta las filas que faltan para el catalogo de texto del upstream. NO
// se activa en el daemon a proposito: dar de alta un modelo es una decision de
// producto (que se vende y con que nombre), no de precio. Uso puntual:
//   node scripts/zenllm-price-sync.mjs --once --adopt-new [--dry-run]
const ADOPT_NEW = argv.includes('--adopt-new');
const VERBOSE = argv.includes('--verbose');
const INTERVAL_MS = Math.max(5, Number(flag('interval', 30))) * 1000;
const MARGIN = Number(flag('margin', 1.25));
// Por defecto se fuerza payg_only=true en todo z/: es un upstream per-token con
// tarifa volátil, y en modo request el precio es plano (no sigue al coste).
const FORCE_PAYG_ONLY = !argv.includes('--no-payg-only');
const DEACTIVATE_MISSING = !argv.includes('--no-deactivate');

if (!Number.isFinite(MARGIN) || MARGIN < 1) {
  console.error(`--margin invalido: ${flag('margin', '')} (debe ser >= 1)`);
  process.exit(1);
}

// ------------------------------------------------------- constantes de precio
// Ver memoria project_aether_request_pricing_model: 1 premium request del plan
// mas barato (Pro, $8/mes, 2250 req/mes) ingresa $0.003556. La request de
// referencia es el cap de contexto de Pro (32768 tok in) + 2000 tok de salida,
// que es holgadamente el p90 del trafico real.
const REVENUE_PER_REQUEST_USD = 0.003556;
const REF_INPUT_MTOK = 32768 / 1_000_000;
const REF_OUTPUT_MTOK = 2000 / 1_000_000;
const CREDITS_PER_USD = 10_000;
// Un catalogo con menos modelos que esto es un payload roto, no un recorte.
const MIN_CATALOG = 10;

// ------------------------------------------------------------------ entorno
const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ZEN_KEY = env.ZENLLM_API_KEY;
const ZEN_BASE = (env.ZENLLM_BASE_URL || 'https://api.zenllm.org/v1').replace(/\/+$/, '');
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}
if (!ZEN_KEY) {
  console.error('falta ZENLLM_API_KEY en .env.local (sin auth el catalogo trae la tarifa PUBLICA, no la nuestra)');
  process.exit(1);
}
const SB_HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// -------------------------------------------------------------------- estado
// Solo se reactiva lo que desactivo este script; si el owner apaga un modelo a
// mano, se queda apagado.
let state = { autoDeactivated: [], reportedNew: [] };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
} catch {
  /* primera ejecucion */
}
const saveState = () => {
  if (DRY) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
};

const logEvent = (event) => {
  const row = { ts: new Date().toISOString(), ...event };
  if (!DRY) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(row) + '\n');
  }
  return row;
};

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const say = (msg) => console.log(`[${stamp()}] ${msg}`);

// ------------------------------------------------------------------ formulas
const round = (n, d) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

function priceModel(inUsd, outUsd) {
  return {
    // Coste plano de una request de referencia, con margen, en unidades de
    // premium request. Solo se usa si algun dia se quita payg_only.
    premium_request_cost: Math.max(
      1,
      Math.ceil(((REF_INPUT_MTOK * inUsd + REF_OUTPUT_MTOK * outUsd) * MARGIN) / REVENUE_PER_REQUEST_USD)
    ),
    // Cada banda de 10k de contexto por encima de los 32k de referencia.
    context_surcharge_per_10k: round((inUsd * 0.01 * MARGIN) / REVENUE_PER_REQUEST_USD, 3),
    // Creditos por 1M de tokens: precio de VENTA, margen ya incluido
    // (paygCredits() no aplica multiplicador ninguno).
    payg_credits_per_m_input: Math.max(1, Math.round(inUsd * CREDITS_PER_USD * MARGIN)),
    payg_credits_per_m_output: Math.max(1, Math.round(outUsd * CREDITS_PER_USD * MARGIN)),
  };
}

// --------------------------------------------------------------------- datos
async function fetchUpstreamCatalog() {
  const r = await fetch(`${ZEN_BASE}/models`, {
    headers: { Authorization: `Bearer ${ZEN_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`GET ${ZEN_BASE}/models -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  const data = Array.isArray(json?.data) ? json.data : null;
  if (!data) throw new Error('respuesta sin data[]');
  if (data.length < MIN_CATALOG) throw new Error(`catalogo sospechosamente corto (${data.length} modelos), se ignora`);

  const byId = new Map();
  for (const m of data) {
    const p = m?.pricing || {};
    // Los precios vienen en micro-USD por 1M tokens (per_mtok_units).
    const inUsd = Number(p.input_per_mtok) / 1e6;
    const outUsd = Number(p.output_per_mtok) / 1e6;
    if (!Number.isFinite(inUsd) || !Number.isFinite(outUsd) || inUsd < 0 || outUsd < 0) continue;
    byId.set(String(m.id), {
      id: String(m.id),
      input: inUsd,
      output: outUsd,
      cacheRead: Math.max(0, Number(p.cached_input_per_mtok) / 1e6 || 0),
      cacheWrite: Math.max(0, Number(p.cache_write_per_mtok) / 1e6 || 0),
      contextLength: Number(m.context_length) || null,
      displayName: m.display_name || m.id,
      // Imagen/video: facturan por imagen/megapixel/clip, no por token, y en
      // el router van por la ruta de media (modality + media_config + el
      // provider comfy). No se pueden dar de alta como modelos de texto.
      isText: (m.architecture?.output_modalities || ['text']).every((o) => o === 'text'),
      features: Array.isArray(m.supported_features) ? m.supported_features : [],
    });
  }
  return byId;
}

const DB_COLS = [
  'id',
  'upstream_model_id',
  'is_active',
  'payg_only',
  'cost_per_m_input',
  'cost_per_m_output',
  'cost_per_m_cache_read',
  'cost_per_m_cache_write',
  'premium_request_cost',
  'context_surcharge_per_10k',
  'payg_credits_per_m_input',
  'payg_credits_per_m_output',
].join(',');

async function fetchDbModels() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/models?select=${DB_COLS}&provider=eq.zenllm&order=id`,
    { headers: SB_HEADERS, signal: AbortSignal.timeout(20_000) }
  );
  if (!r.ok) throw new Error(`GET models -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// El catalogo de ZenLLM y el vocabulario de `models.capabilities` no usan los
// mismos nombres. system_message lo soportan todos (es un gateway OpenAI-compat).
const FEATURE_MAP = {
  streaming: 'streaming',
  tools: 'tool_calling',
  vision: 'vision',
  reasoning: 'reasoning',
  json_mode: 'json_mode',
};
function capabilitiesFor(up) {
  const caps = new Set(['system_message']);
  for (const f of up.features) if (FEATURE_MAP[f]) caps.add(FEATURE_MAP[f]);
  caps.add('streaming');
  return [...caps];
}

async function insertModels(rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/models`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`POST models -> ${r.status} ${(await r.text()).slice(0, 300)}`);
}

async function patchModel(id, patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/models?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`PATCH ${id} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// --------------------------------------------------------------------- ciclo
const NUMERIC_EPS = 1e-9;
const differs = (a, b) => {
  if (typeof b === 'boolean') return Boolean(a) !== b;
  return Math.abs(Number(a ?? 0) - Number(b)) > NUMERIC_EPS;
};

async function syncOnce() {
  const [catalog, dbRows] = await Promise.all([fetchUpstreamCatalog(), fetchDbModels()]);

  const changes = [];
  const deactivated = [];
  const reactivated = [];
  const missing = [];

  for (const row of dbRows) {
    const up = catalog.get(row.upstream_model_id);

    // --- el modelo ya no existe upstream ------------------------------------
    if (!up) {
      missing.push(row.id);
      if (row.is_active && DEACTIVATE_MISSING) {
        if (!DRY) await patchModel(row.id, { is_active: false });
        if (!state.autoDeactivated.includes(row.id)) state.autoDeactivated.push(row.id);
        deactivated.push(row.id);
        logEvent({ kind: 'deactivated', id: row.id, upstream_model_id: row.upstream_model_id, dry: DRY });
      }
      continue;
    }

    const target = {
      cost_per_m_input: up.input,
      cost_per_m_output: up.output,
      cost_per_m_cache_read: up.cacheRead,
      cost_per_m_cache_write: up.cacheWrite,
      ...priceModel(up.input, up.output),
    };
    if (FORCE_PAYG_ONLY) target.payg_only = true;

    // --- volvio al catalogo: se reactiva solo si lo apago este script --------
    if (!row.is_active && state.autoDeactivated.includes(row.id)) {
      target.is_active = true;
      reactivated.push(row.id);
    }

    const patch = {};
    for (const [k, v] of Object.entries(target)) {
      if (differs(row[k], v)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) continue;

    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k]]));
    if (!DRY) await patchModel(row.id, patch);
    if (target.is_active === true) {
      state.autoDeactivated = state.autoDeactivated.filter((x) => x !== row.id);
    }
    changes.push({ id: row.id, before, after: patch });
    logEvent({ kind: 'reprice', id: row.id, before, after: patch, margin: MARGIN, dry: DRY });
  }

  // --- modelos del upstream sin fila --------------------------------------
  // Con --adopt-new se dan de alta; sin el flag solo se reportan (una vez por
  // id, via state) para que el daemon no decida solo que se vende.
  const known = new Set(dbRows.map((r) => r.upstream_model_id));
  const byLocalId = new Map(dbRows.map((r) => [r.id, r]));
  const fresh = [];
  const adopted = [];
  const relinked = [];
  const skippedMedia = [];
  const toInsert = [];

  for (const [id, up] of catalog) {
    if (known.has(id)) continue;
    if (!up.isText) {
      skippedMedia.push(id);
      continue;
    }
    const localId = `z/${id}`;
    const priced = priceModel(up.input, up.output);

    // Ya existe la fila pero apuntando a un upstream_model_id viejo (z/ renombro
    // el modelo, p.ej. anthropic/claude-sonnet-4.5 -> claude-sonnet-4.5): se
    // repunta en vez de insertar, que chocaria con la PK.
    const stale = byLocalId.get(localId);
    if (stale) {
      if (!ADOPT_NEW) continue;
      const patch = {
        upstream_model_id: id,
        is_active: true,
        payg_only: FORCE_PAYG_ONLY ? true : stale.payg_only,
        // La fila vieja puede venir de antes de que existieran estas columnas.
        display_name: up.displayName,
        modality: 'text',
        context_length: up.contextLength,
        capabilities: capabilitiesFor(up),
        cost_per_m_input: up.input,
        cost_per_m_output: up.output,
        cost_per_m_cache_read: up.cacheRead,
        cost_per_m_cache_write: up.cacheWrite,
        ...priced,
      };
      if (!DRY) await patchModel(localId, patch);
      relinked.push({ id: localId, from: stale.upstream_model_id, to: id });
      logEvent({ kind: 'relinked', id: localId, from: stale.upstream_model_id, to: id, dry: DRY });
      continue;
    }

    if (!ADOPT_NEW) {
      if (state.reportedNew.includes(id)) continue;
      state.reportedNew.push(id);
      fresh.push({ id, ...priced, input: up.input, output: up.output });
      logEvent({ kind: 'new_upstream_model', id, input: up.input, output: up.output, suggested: priced });
      continue;
    }

    toInsert.push({
      id: localId,
      provider: 'zenllm',
      display_name: up.displayName,
      upstream_model_id: id,
      is_active: true,
      payg_only: FORCE_PAYG_ONLY,
      modality: 'text',
      context_length: up.contextLength,
      capabilities: capabilitiesFor(up),
      // `margin` solo se usa en la ruta de coste no-PAYG; se deja el valor por
      // defecto del resto del catalogo para no inventar otro.
      margin: 1.55,
      cost_per_m_input: up.input,
      cost_per_m_output: up.output,
      cost_per_m_cache_read: up.cacheRead,
      cost_per_m_cache_write: up.cacheWrite,
      ...priced,
    });
    adopted.push({ id: localId, input: up.input, output: up.output, ...priced });
  }

  if (toInsert.length) {
    if (!DRY) await insertModels(toInsert);
    for (const row of toInsert) logEvent({ kind: 'adopted', id: row.id, row, dry: DRY });
    // Ya estan en la tabla: fuera de la lista de "pendientes de revisar".
    state.reportedNew = state.reportedNew.filter((x) => !toInsert.some((r) => r.upstream_model_id === x));
  }

  saveState();
  return {
    changes, deactivated, reactivated, missing, fresh, adopted, relinked, skippedMedia,
    catalogSize: catalog.size, dbSize: dbRows.length,
  };
}

// -------------------------------------------------------------------- salida
function report(res) {
  const tag = DRY ? 'DRY ' : '';
  for (const c of res.changes) {
    const bits = Object.keys(c.after).map((k) => `${k}: ${c.before[k]} -> ${c.after[k]}`);
    say(`${tag}${c.id}  ${bits.join(' | ')}`);
  }
  if (res.deactivated.length) say(`${tag}desactivados (ya no estan upstream): ${res.deactivated.join(', ')}`);
  if (res.reactivated.length) say(`${tag}reactivados (volvieron upstream): ${res.reactivated.join(', ')}`);
  for (const r of res.relinked ?? []) say(`${tag}repuntado ${r.id}: upstream_model_id ${r.from} -> ${r.to} (reactivado)`);
  for (const a of res.adopted ?? []) {
    say(
      `${tag}ALTA ${a.id}  $${a.input}/$${a.output} por M  ` +
        `-> payg ${a.payg_credits_per_m_input}/${a.payg_credits_per_m_output} cr`
    );
  }
  if (ADOPT_NEW && res.skippedMedia?.length) {
    say(`${tag}omitidos (imagen/video, facturan por imagen/clip y necesitan la ruta de media): ${res.skippedMedia.length} -> ${res.skippedMedia.join(', ')}`);
  }
  for (const f of res.fresh) {
    say(
      `${tag}NUEVO upstream sin fila en models: ${f.id}  $${f.input}/$${f.output} por M  ` +
        `-> payg ${f.payg_credits_per_m_input}/${f.payg_credits_per_m_output} cr, ${f.premium_request_cost} req`
    );
  }
  if (res.changes.length === 0 && res.deactivated.length === 0 && res.fresh.length === 0) {
    if (VERBOSE || ONCE) say(`sin cambios (${res.dbSize} modelos z/, ${res.catalogSize} upstream)`);
  }
}

let consecutiveFailures = 0;

async function tick() {
  try {
    const res = await syncOnce();
    consecutiveFailures = 0;
    report(res);
  } catch (err) {
    consecutiveFailures++;
    const msg = err?.message || String(err);
    say(`ERROR (${consecutiveFailures} seguidos): ${msg}`);
    logEvent({ kind: 'error', message: msg, consecutive: consecutiveFailures });
    // El gateway de ZenLLM se ha caido entero varias veces (530 / VPS abajo).
    // No se toca la DB: los precios vigentes se quedan como estan, que es lo
    // seguro, y el aviso sale cada 10 fallos (~5 min) para no llenar el log.
    if (consecutiveFailures % 10 === 0) {
      say(`AVISO: ${consecutiveFailures} ciclos fallidos seguidos, precios sin actualizar desde hace ~${Math.round((consecutiveFailures * INTERVAL_MS) / 60000)} min`);
    }
  }
}

say(
  `zenllm-price-sync  margen ${MARGIN}  intervalo ${INTERVAL_MS / 1000}s  ` +
    `payg_only=${FORCE_PAYG_ONLY}  deactivate=${DEACTIVATE_MISSING}${DRY ? '  [DRY RUN]' : ''}`
);

await tick();
if (!ONCE) {
  const timer = setInterval(tick, INTERVAL_MS);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      clearInterval(timer);
      say(`${sig} -> saliendo`);
      process.exit(0);
    });
  }
}
