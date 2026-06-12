// Live health check of the moderation backends, replicating fetchModeration().
// Reads keys from .env.local. Benign input. Prints status only (no secrets).
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const MODEL = "omni-moderation-latest";
const base = (env.MODERATION_BASE_URL || "https://beta.hapuppy.com/v1").replace(/\/+$/, "");
const backends = [];
const primaryKey = env.MODERATION_API_KEY || env.HAPUPPY_API_KEY;
if (primaryKey) backends.push({ name: "hapuppy", url: `${base}/moderations`, apiKey: primaryKey });
if (env.OPENAI_API_KEY) backends.push({ name: "openai", url: "https://api.openai.com/v1/moderations", apiKey: env.OPENAI_API_KEY });

async function test(b) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  const t0 = Date.now();
  try {
    const r = await fetch(b.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${b.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: ["hello, how are you today?"] }),
    });
    const dt = Date.now() - t0;
    const body = await r.text();
    let ok2 = false;
    try { ok2 = Array.isArray(JSON.parse(body).results); } catch {}
    console.log(`[${b.name}] HTTP ${r.status} ${dt}ms  results_ok=${ok2}  ${r.ok ? "" : body.slice(0, 200)}`);
  } catch (e) {
    console.log(`[${b.name}] FETCH FAILED ${Date.now() - t0}ms  ${e.message}`);
  } finally { clearTimeout(t); }
}

console.log(`backends: ${backends.map((b) => b.name).join(", ") || "NONE"}  base=${base}`);
for (const b of backends) await test(b);
