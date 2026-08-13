// Fingerprint de upstreams: intenta deducir DE DONDE saca cada reseller su API.
// Solo hace lecturas / requests minimos (max_tokens=1) contra proveedores que ya pagamos.
// Run: node scripts/fingerprint-providers.mjs [prefijo...]
//   ej: node scripts/fingerprint-providers.mjs sh bl z
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- env ---------------------------------------------------------------
const env = { ...process.env };
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Varias keys son POOLS separados por coma (routmy, blaze, ...). Usar la 1a.
const one = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean)[0];

// --- catalogo ----------------------------------------------------------
const PROVIDERS = [
  { id: "sh", name: "sh00t.host",  base: env.SHOOT_BASE_URL   || "https://sh00t.host/v1",        key: one(env.SHOOT_API_KEY) },
  { id: "bl", name: "blazeapi",    base: env.BLAZE_BASE_URL   || "https://api.blazeapi.org/paid/v1", key: one(env.BLAZE_API_KEY) },
  { id: "z",  name: "zenllm",      base: env.ZENLLM_BASE_URL  || "https://api.zenllm.org/v1",    key: one(env.ZENLLM_API_KEY) },
  { id: "t",  name: "trolllm",     base: env.TROLLLLM_BASE_URL|| "https://chat.trollllm.xyz/v1", key: one(env.TROLLLLM_API_KEY) },
  { id: "rt", name: "rout.my",     base: env.ROUTMY_BASE_URL  || "https://api.rout.my/v1",       key: one(env.ROUTMY_API_KEY) },
  { id: "r",  name: "riftai",      base: env.RIFTAI_BASE_URL  || "https://riftai.su/v1",         key: one(env.RIFTAI_API_KEY || env.RIFT_API_KEY) },
  { id: "at", name: "atessa",      base: "https://atessa.top/v1",                                 key: one(env.ATESSA_API_KEY) },
  { id: "h",  name: "hapuppy",     base: env.HAPUPPY_BASE_URL || "https://beta.hapuppy.com/v1",  key: one(env.HAPUPPY_API_KEY) },
  { id: "db", name: "dlab",        base: "https://api.dlabkeys.com/v1",                           key: one(env.DLAB_API_KEY) },
  { id: "gm", name: "gameron",     base: env.GAMERON_BASE_URL || "https://api.gameron.me/v1",    key: one(env.GAMERON_PRIMARY_KEY) },
  { id: "oc", name: "opencode",    base: "https://opencode.ai/zen/go/v1",                         key: one(env.OPENCODE_API_KEY) },
  { id: "na", name: "nano",        base: env.NANO_BASE_URL    || "https://nano-gpt.com/api/v1",  key: one(env.NANO_API_KEY) },
  { id: "ds", name: "deepseek",    base: env.DEEPSEEK_BASE_URL|| "https://api.deepseek.com",     key: one(env.DEEPSEEK_API_KEY), control: true },
];

// Headers que delatan al upstream real o al software de gateway.
const TELLS = [
  // infra / CDN / hosting
  "server", "via", "x-powered-by", "cf-ray", "cf-cache-status", "x-vercel-id",
  "x-render-origin-server", "fly-request-id", "x-served-by", "x-amz-cf-id",
  // upstream real
  "anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-tokens-remaining",
  "anthropic-ratelimit-input-tokens-remaining", "anthropic-organization-id", "request-id",
  "openai-organization", "openai-processing-ms", "openai-version", "x-request-id",
  "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens",
  "azureml-model-session", "apim-request-id", "x-ms-region",
  "x-amzn-requestid", "x-amzn-bedrock-input-token-count", "x-goog-request-params",
  // software de gateway conocido
  "x-oneapi-request-id", "x-new-api-request-id", "x-litellm-model-id", "x-litellm-call-id",
  "x-portkey-trace-id", "x-envoy-upstream-service-time", "x-helicone-id",
];

const HINTS = [
  [/litellm/i,                    "LiteLLM proxy"],
  [/one[-_ ]?api|new[-_ ]?api/i,  "one-api / new-api (gateway chino open-source)"],
  [/msg_bdrk_/,                   "AWS Bedrock (id msg_bdrk_)"],
  [/ValidationException|ThrottlingException|amzn/i, "AWS Bedrock (error shape)"],
  [/INVALID_ARGUMENT|generativelanguage|aiplatform|publishers\/anthropic/i, "Google Vertex / AI Studio"],
  [/content_filter_results|prompt_filter_results|jailbreak/i, "Azure OpenAI (content filter)"],
  [/"type"\s*:\s*"error".*"invalid_request_error"/s, "API Anthropic directa (shape nativo)"],
  [/chatcmpl-[A-Za-z0-9]{20,}/,   "OpenAI-compat generico"],
  [/gen-\d{10,}/,                 "OpenRouter (id gen-)"],
  [/You are Claude Code|claude-cli|anthropic-beta.*oauth/i, "Suscripcion Claude Code / OAuth (no API key)"],
  [/copilot|githubcopilot/i,      "GitHub Copilot backend"],
  [/codewhisperer|kiro|q-developer/i, "AWS CodeWhisperer / Kiro"],
  [/cloudflare/i,                 "detras de Cloudflare"],
];

const args = process.argv.slice(2);
const targets = args.length ? PROVIDERS.filter((p) => args.includes(p.id)) : PROVIDERS;

function pickHeaders(h) {
  const out = {};
  for (const [k, v] of h.entries()) {
    const lk = k.toLowerCase();
    if (TELLS.includes(lk) || lk.startsWith("anthropic-") || lk.startsWith("openai-") ||
        lk.startsWith("x-amzn") || lk.startsWith("x-goog") || lk.startsWith("x-litellm") ||
        lk.startsWith("x-oneapi") || lk.startsWith("x-new-api")) out[lk] = v;
  }
  return out;
}

async function req(p, pathname, body, timeoutMs = 45000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(p.base.replace(/\/$/, "") + pathname, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${p.key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
      redirect: "manual",
    });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - started, headers: pickHeaders(r.headers), text };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, headers: {}, text: `FETCH_ERROR: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

function detect(blobs) {
  const joined = blobs.join("\n");
  const hits = [];
  for (const [re, label] of HINTS) if (re.test(joined) && !hits.includes(label)) hits.push(label);
  return hits;
}

const report = [];

for (const p of targets) {
  if (!p.key) { console.log(`\n=== ${p.id}/ ${p.name} â€” SIN KEY en env, salto`); continue; }
  console.log(`\n=== ${p.id}/ ${p.name}  (${p.base})`);
  const entry = { id: p.id, name: p.name, base: p.base, probes: {} };

  // 1) catalogo de modelos: nombres delatan el backend (us.anthropic.*, ...@2024, etc)
  const models = await req(p, "/models");
  entry.probes.models = models;
  let ids = [];
  try { ids = (JSON.parse(models.text).data || []).map((m) => m.id); } catch {}
  console.log(`  /models -> ${models.status} (${models.ms}ms) ${ids.length} modelos`);
  if (Object.keys(models.headers).length) console.log(`    headers:`, models.headers);
  if (ids.length) console.log(`    muestra: ${ids.slice(0, 6).join(", ")}`);

  const probeModel =
    ids.find((m) => /opus/i.test(m)) || ids.find((m) => /sonnet|claude/i.test(m)) || ids[0];

  // 2) modelo inexistente -> el error revela el software de gateway
  const bogus = await req(p, "/chat/completions", {
    model: "aether-fingerprint-nonexistent-model",
    messages: [{ role: "user", content: "x" }],
    max_tokens: 1,
  });
  entry.probes.bogusModel = bogus;
  console.log(`  modelo-inexistente -> ${bogus.status}: ${bogus.text.slice(0, 300)}`);

  if (probeModel) {
    // 3) parametro invalido -> error crudo del upstream real (suele NO ser reescrito)
    const badParam = await req(p, "/chat/completions", {
      model: probeModel,
      messages: [{ role: "user", content: "x" }],
      max_tokens: 1,
      temperature: 9.9,
    });
    entry.probes.badParam = badParam;
    console.log(`  param-invalido (${probeModel}) -> ${badParam.status}: ${badParam.text.slice(0, 300)}`);

    // 4) generacion minima real -> id, system_fingerprint, forma de usage, headers
    const ok = await req(p, "/chat/completions", {
      model: probeModel,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      stream: false,
    });
    entry.probes.minimal = ok;
    let parsed = null;
    try { parsed = JSON.parse(ok.text); } catch {}
    console.log(`  gen-minima -> ${ok.status} (${ok.ms}ms)`);
    if (parsed) {
      console.log(`    id=${parsed.id}  model=${parsed.model}  fp=${parsed.system_fingerprint ?? "-"}`);
      console.log(`    usage=${JSON.stringify(parsed.usage)}`);
    } else {
      console.log(`    body: ${ok.text.slice(0, 300)}`);
    }
    if (Object.keys(ok.headers).length) console.log(`    headers:`, ok.headers);
  }

  entry.hints = detect([
    JSON.stringify(entry.probes.models?.headers), entry.probes.models?.text?.slice(0, 4000) || "",
    JSON.stringify(entry.probes.bogusModel?.headers), entry.probes.bogusModel?.text || "",
    JSON.stringify(entry.probes.badParam?.headers), entry.probes.badParam?.text || "",
    JSON.stringify(entry.probes.minimal?.headers), entry.probes.minimal?.text?.slice(0, 4000) || "",
  ]);
  if (entry.hints.length) console.log(`  >> PISTAS: ${entry.hints.join(" | ")}`);
  report.push(entry);
}

// Fuera del repo a proposito: el repo es respaldo PUBLICO y esto lleva bodies crudos.
const out = path.join(ROOT, "..", "fingerprint-report.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nReporte completo -> ${out}`);

