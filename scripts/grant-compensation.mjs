// grant-compensation.mjs — regalo masivo de créditos a todos los usuarios.
//
//   node scripts/grant-compensation.mjs                 -> DRY RUN (no escribe nada)
//   node scripts/grant-compensation.mjs --confirm       -> ejecuta
//   node scripts/grant-compensation.mjs --amount 10000 --reference compensation-2026-08-stability
//   node scripts/grant-compensation.mjs --include-banned
//
// Idempotente por `reference`: quien ya tenga una transacción con esa misma
// reference se salta, así que re-correrlo tras un fallo a mitad NO duplica.
// Excluye cuentas baneadas (auth.users.banned_until futuro) salvo --include-banned.
//
// Deja registro contable en logs/compensations/<reference>.json — ese archivo es
// el respaldo para poder revertir (cada fila lleva user_id, monto y balance).
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(REPO, '.env.local');
const LOG_DIR = path.join(REPO, 'logs', 'compensations');

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const CONFIRM = argv.includes('--confirm');
const INCLUDE_BANNED = argv.includes('--include-banned');
const AMOUNT = Number(flag('amount', 10000));
const REFERENCE = flag('reference', 'compensation-2026-08-stability');
const DESCRIPTION = flag('description', 'Compensation for August 2026 stability issues');

if (!Number.isInteger(AMOUNT) || AMOUNT <= 0) {
  console.error('--amount debe ser un entero positivo');
  process.exit(1);
}

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
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const rest = async (p, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} -> ${r.status} ${await r.text()}`);
  // Prefer: return=minimal responde 201/204 con cuerpo VACÍO — parsearlo como
  // JSON revienta y haría creer que la escritura falló cuando sí entró.
  const body = await r.text();
  return body ? JSON.parse(body) : null;
};

// Paginado: PostgREST corta en 1000 por defecto.
const pageAll = async (table, query) => {
  const out = [];
  const STEP = 1000;
  for (let from = 0; ; from += STEP) {
    const rows = await rest(`${table}?${query}`, {
      headers: { Range: `${from}-${from + STEP - 1}`, 'Range-Unit': 'items' },
    });
    out.push(...rows);
    if (rows.length < STEP) return out;
  }
};

// --- 1. universo de usuarios --------------------------------------------------
const profiles = await pageAll('profiles', 'select=id,email,credits&order=created_at.asc');

// --- 2. baneados (GoTrue: auth.users.banned_until) ----------------------------
const banned = new Set();
for (let page = 1; ; page++) {
  const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: H });
  if (!r.ok) throw new Error(`auth admin users -> ${r.status}`);
  const users = (await r.json()).users || [];
  for (const u of users) {
    if (u.banned_until && new Date(u.banned_until) > new Date()) banned.add(u.id);
  }
  if (users.length < 1000) break;
}

// --- 3. ya cobrados (idempotencia por reference) ------------------------------
const already = new Set(
  (await pageAll('transactions', `select=user_id&reference=eq.${encodeURIComponent(REFERENCE)}`))
    .map((t) => t.user_id)
);

const targets = profiles.filter(
  (p) => !already.has(p.id) && (INCLUDE_BANNED || !banned.has(p.id))
);

console.log(`referencia   : ${REFERENCE}`);
console.log(`monto        : ${AMOUNT.toLocaleString('en-US')} créditos c/u`);
console.log(`perfiles     : ${profiles.length}`);
console.log(`baneados     : ${banned.size} ${INCLUDE_BANNED ? '(INCLUIDOS)' : '(excluidos)'}`);
console.log(`ya cobrados  : ${already.size} (se saltan)`);
console.log(`a otorgar    : ${targets.length}`);
console.log(`total a dar  : ${(targets.length * AMOUNT).toLocaleString('en-US')} créditos`);

if (!CONFIRM) {
  console.log('\nDRY RUN — no se escribió nada. Añade --confirm para ejecutar.');
  process.exit(0);
}

// --- 4. otorgar ---------------------------------------------------------------
const results = [];
const failures = [];
const CONCURRENCY = 6;
let done = 0;

const grantOne = async (p) => {
  // add_credits es atómico (UPDATE ... credits + p_amount RETURNING credits).
  const newBalance = await rest('rpc/add_credits', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: p.id, p_amount: AMOUNT }),
  });
  // La transacción es el registro contable + la marca de idempotencia.
  await rest('transactions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: p.id,
      amount: AMOUNT,
      balance: newBalance,
      type: 'admin_grant',
      reference: REFERENCE,
      description: DESCRIPTION,
    }),
  });
  results.push({ user_id: p.id, email: p.email, before: p.credits, after: newBalance });
};

const queue = [...targets];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      try {
        await grantOne(p);
      } catch (e) {
        failures.push({ user_id: p.id, email: p.email, error: String(e).slice(0, 300) });
      }
      if (++done % 50 === 0) process.stdout.write(`  ${done}/${targets.length}\n`);
    }
  })
);

fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `${REFERENCE}.json`);
const prev = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : { runs: [] };
prev.runs.push({
  at: new Date().toISOString(),
  amount: AMOUNT,
  reference: REFERENCE,
  description: DESCRIPTION,
  granted: results.length,
  failed: failures.length,
  results,
  failures,
});
fs.writeFileSync(logFile, JSON.stringify(prev, null, 2));

console.log(`\notorgados : ${results.length}`);
console.log(`fallidos  : ${failures.length}${failures.length ? ' (re-corre el script: es idempotente)' : ''}`);
console.log(`registro  : ${path.relative(REPO, logFile)}`);
if (failures.length) console.log(failures.slice(0, 5));
