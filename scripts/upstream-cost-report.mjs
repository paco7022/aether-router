// upstream-cost-report.mjs — cuánto nos costó cada proveedor, para cuadrar
// contra la factura/panel del reseller.
//
//   node scripts/upstream-cost-report.mjs                      -> últimos 7 días, todos
//   node scripts/upstream-cost-report.mjs --provider z --days 30
//   node scripts/upstream-cost-report.mjs --provider z --by-model
//   node scripts/upstream-cost-report.mjs --provider z --days 1 --csv costes.csv
//
// Lee usage_logs.upstream_cost_usd, que se escribe por request con los tokens
// que REPORTA el upstream (su propio conteo, que es por el que factura) por el
// cost_per_m_* del modelo en ese momento. Es independiente de lo cobrado al
// cliente: en PAYG y en keys enterprise cost_usd guarda el importe COBRADO, no
// el coste.
//
// OJO: las filas anteriores al 2026-09-05 no tienen la columna (sale null y se
// cuentan aparte como "sin dato"). Tampoco tiene sentido recalcularlas: los
// cost_per_m_* cambian (ZenLLM aplicó un descuento ×10 ese mismo día).
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(REPO, '.env.local');

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const PROVIDER = flag('provider', null);       // prefijo del id: z, t, or, bl...
const DAYS = Number(flag('days', 7));
const BY_MODEL = argv.includes('--by-model');
const CSV = flag('csv', null);

const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
const cols = 'model_id,created_at,status,prompt_tokens,completion_tokens,cache_read_tokens,upstream_cost_usd,credits_charged,premium_cost';
let filter = `created_at=gte.${since}`;
if (PROVIDER) filter += `&model_id=like.${PROVIDER}/*`;

// PostgREST corta en 1000 por página.
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const r = await fetch(
    `${URL_}/rest/v1/usage_logs?select=${cols}&${filter}&order=created_at.desc&limit=1000&offset=${offset}`,
    { headers: H }
  );
  if (!r.ok) {
    console.error(`GET usage_logs -> ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  const page = await r.json();
  rows.push(...page);
  if (page.length < 1000) break;
}

const usd = (n) => '$' + n.toFixed(6);
const day = (iso) => iso.slice(0, 10);
const groupKey = (row) => (BY_MODEL ? row.model_id : row.model_id.split('/')[0] + '/');

const buckets = new Map();
let noData = 0;
for (const row of rows) {
  if (row.upstream_cost_usd === null) { noData++; continue; }
  const k = groupKey(row);
  const b = buckets.get(k) || { reqs: 0, cost: 0, inTok: 0, outTok: 0, cached: 0, credits: 0, premium: 0, errors: 0 };
  b.reqs++;
  b.cost += Number(row.upstream_cost_usd);
  b.inTok += row.prompt_tokens || 0;
  b.outTok += row.completion_tokens || 0;
  b.cached += row.cache_read_tokens || 0;
  b.credits += Number(row.credits_charged || 0);
  b.premium += Number(row.premium_cost || 0);
  if (row.status !== 'success') b.errors++;
  buckets.set(k, b);
}

const sorted = [...buckets.entries()].sort((a, b) => b[1].cost - a[1].cost);
const label = BY_MODEL ? 'modelo' : 'provider';
console.log(`\nCoste upstream — últimos ${DAYS} día(s)${PROVIDER ? `, provider ${PROVIDER}/` : ''}`);
console.log(`desde ${since}\n`);
console.log(
  label.padEnd(BY_MODEL ? 26 : 12), 'reqs'.padStart(7), 'coste'.padStart(12),
  'ingreso'.padStart(11), 'in tok'.padStart(12), 'out tok'.padStart(11), 'cached'.padStart(11), 'err'.padStart(5)
);
let totalCost = 0, totalRevenue = 0, totalReqs = 0;
for (const [k, b] of sorted) {
  // Ingreso: créditos cobrados (1 cr = $0.0001). Las premium requests no son
  // dinero directo — salen del pool del plan — así que van aparte, en la nota.
  const revenue = b.credits / 10000;
  totalCost += b.cost; totalRevenue += revenue; totalReqs += b.reqs;
  console.log(
    k.padEnd(BY_MODEL ? 26 : 12), String(b.reqs).padStart(7), usd(b.cost).padStart(12),
    usd(revenue).padStart(11), b.inTok.toLocaleString().padStart(12),
    b.outTok.toLocaleString().padStart(11), b.cached.toLocaleString().padStart(11),
    String(b.errors).padStart(5)
  );
}
console.log('-'.repeat(BY_MODEL ? 100 : 86));
console.log(
  'TOTAL'.padEnd(BY_MODEL ? 26 : 12), String(totalReqs).padStart(7),
  usd(totalCost).padStart(12), usd(totalRevenue).padStart(11)
);
if (noData) console.log(`\n(${noData} filas sin upstream_cost_usd — anteriores al despliegue de la columna)`);
console.log('\nNota: "ingreso" son solo créditos cobrados. En modo request el pago viene');
console.log('de la suscripción vía premium requests, que no se convierten a USD aquí.');
const premiumTotal = sorted.reduce((a, [, b]) => a + b.premium, 0);
if (premiumTotal > 0) console.log(`Premium requests consumidas en el periodo: ${premiumTotal.toFixed(2)}`);

if (CSV) {
  const lines = ['fecha,model_id,status,prompt_tokens,completion_tokens,cache_read_tokens,upstream_cost_usd,credits_charged'];
  for (const row of rows) {
    if (row.upstream_cost_usd === null) continue;
    lines.push([day(row.created_at), row.model_id, row.status, row.prompt_tokens, row.completion_tokens,
      row.cache_read_tokens, row.upstream_cost_usd, row.credits_charged].join(','));
  }
  fs.writeFileSync(CSV, lines.join('\n'), 'utf8');
  console.log(`\nCSV escrito: ${CSV} (${lines.length - 1} filas)`);
}
