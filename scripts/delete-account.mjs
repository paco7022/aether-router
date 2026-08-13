// delete-account.mjs — borrado de cuenta a pedido del titular (GDPR-style).
//
//   node scripts/delete-account.mjs <email>            -> DRY RUN (no escribe nada)
//   node scripts/delete-account.mjs <email> --confirm  -> ejecuta
//
// Orden: export a disco -> purga tablas sin CASCADE -> delete auth user (cascadea el resto).
// Las filas de dinero (transactions) quedan en el archivo exportado: ese archivo ES el
// registro contable. No lo borres.
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(REPO, '.env.local');
const EXPORT_DIR = path.join(REPO, 'logs', 'account-deletions');

const email = process.argv[2];
const CONFIRM = process.argv.includes('--confirm');
const KEEP_ABUSE_SIGNALS = !process.argv.includes('--purge-abuse-signals');
if (!email) {
  console.error('usage: node scripts/delete-account.mjs <email> [--confirm] [--purge-abuse-signals]');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const rest = async (p, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

// --- 1. localizar al usuario -------------------------------------------------
const au = await (await fetch(
  `${URL_}/auth/v1/admin/users?page=1&per_page=200&filter=${encodeURIComponent(email)}`,
  { headers: H },
)).json();
const user = (au.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
if (!user) { console.error(`no existe usuario con email ${email}`); process.exit(1); }
const uid = user.id;
console.log(`usuario: ${email}  uid=${uid}  alta=${user.created_at}  ultimo_login=${user.last_sign_in_at}`);

// --- 2. export completo ------------------------------------------------------
// moderation_reviews se exporta SIN flagged_text/context: ese contenido no se re-vuelca a disco acá.
const TABLES = [
  { name: 'profiles', col: 'id', select: '*' },
  { name: 'transactions', col: 'user_id', select: '*' },
  { name: 'subscriptions', col: 'user_id', select: '*' },
  { name: 'api_keys', col: 'user_id', select: 'id,user_id,key_prefix,name,is_active,created_at,last_used' },
  { name: 'usage_logs', col: 'user_id', select: '*' },
  { name: 'moderation_reviews', col: 'user_id', select: 'id,user_id,content_hash,categories,source,status,reviewed_by,reviewed_at,created_at' },
  { name: 'device_fingerprints', col: 'user_id', select: '*' },
];

const dump = { email, uid, exported_at: new Date().toISOString(), auth_user: user, tables: {} };
for (const t of TABLES) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest(`${t.name}?${t.col}=eq.${uid}&select=${t.select}&order=created_at.asc&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  dump.tables[t.name] = rows;
  console.log(`  ${String(rows.length).padStart(6)}  ${t.name}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(EXPORT_DIR, `${email.replace(/[^a-z0-9]/gi, '_')}_${stamp}.json`);

if (!CONFIRM) {
  console.log('\n--- DRY RUN: no se escribio ni borro nada. Reejecuta con --confirm ---');
  console.log(`export iria a: ${outFile}`);
  console.log(`saldo a destruir: ${dump.tables.profiles[0]?.credits ?? '?'} creditos`);
  console.log(`compras Stripe en el historial: ${dump.tables.transactions.filter(t => t.type === 'purchase').length}`);
  console.log(`anti-abuso: device_fingerprints ${KEEP_ABUSE_SIGNALS ? 'SE CONSERVAN' : 'SE BORRAN'}`);
  process.exit(0);
}

fs.mkdirSync(EXPORT_DIR, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(dump, null, 2), 'utf8');
console.log(`\nexport escrito: ${outFile}`);

// --- 3. purga --------------------------------------------------------------
// usage_logs y transactions tienen FK NOT NULL sin ON DELETE -> hay que borrarlas
// a mano o el delete del profile falla. usage_logs va primero (FK a api_keys).
if (KEEP_ABUSE_SIGNALS) {
  // desligar el fingerprint del uid para que no cascadee, conservando la señal
  await rest(`device_fingerprints?user_id=eq.${uid}`, {
    method: 'PATCH', body: JSON.stringify({ user_id: null }),
  }).catch(e => console.warn(`  aviso: no se pudo desligar device_fingerprints (${e.message}); cascadeara`));
}
for (const table of ['usage_logs', 'transactions']) {
  await rest(`${table}?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  console.log(`  purgado: ${table}`);
}

// --- 4. borrar el auth user (cascadea profiles -> api_keys, subscriptions, ...)
const del = await fetch(`${URL_}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
if (!del.ok) { console.error(`fallo el delete de auth.users: ${del.status} ${await del.text()}`); process.exit(1); }
console.log(`  borrado: auth.users + cascade`);

// --- 5. verificacion ---------------------------------------------------------
const left = await rest(`profiles?id=eq.${uid}&select=id`);
console.log(left.length === 0
  ? `\nOK: cuenta ${email} eliminada. Registro contable en ${outFile}`
  : `\nATENCION: profiles todavia tiene fila para ${uid}`);
