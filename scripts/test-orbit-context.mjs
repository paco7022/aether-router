// Multi-turn context recall through OUR orbit.ts adapter (OpenAI shape).
// Reproduces the real production path: app sends OpenAI messages, adapter
// converts to Anthropic. Run: npx tsx scripts/test-orbit-context.mjs
if (!process.env.ORBIT_API_KEY) {
  console.error("ORBIT_API_KEY is required. Set it in your env before running this smoke-test.");
  process.exit(1);
}
const { orbitProvider } = await import("../src/lib/providers/orbit.ts");

const MESSAGES = [
  { role: "system", content: "Eres un asistente util. Responde en espanol." },
  { role: "user", content: "Hola. Mi nombre es Ricardo y mi color favorito es el verde." },
  { role: "assistant", content: "Hola Ricardo, encantado. El verde es un gran color." },
  { role: "user", content: "Tengo un perro llamado Pluto y vivo en la ciudad de Quito." },
  { role: "assistant", content: "Que bien, Pluto debe ser un buen compañero en Quito." },
  { role: "user", content: "Mi numero secreto es 4729. No lo olvides." },
  { role: "assistant", content: "Entendido, lo recordare." },
  { role: "user", content: "Responde SOLO con esta linea exacta -> NOMBRE=?, COLOR=?, PERRO=?, CIUDAD=?, NUMERO=? rellenando cada ? con lo que te dije." },
];
const EXPECT = { NOMBRE: "ricardo", COLOR: "verde", PERRO: "pluto", CIUDAD: "quito", NUMERO: "4729" };

function score(text) {
  const low = text.toLowerCase();
  const hits = {};
  let n = 0;
  for (const [k, v] of Object.entries(EXPECT)) { hits[k] = low.includes(v); if (hits[k]) n++; }
  return { hits, n };
}

async function run(model, stream) {
  const r = await orbitProvider.forward({ model, messages: MESSAGES, max_tokens: 300, temperature: 0, stream });
  let content = "";
  let usage = null;
  if (stream) {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, nl).trim(); buf = buf.slice(nl + 2);
        if (!block.startsWith("data:")) continue;
        const p = block.slice(5).trim();
        if (p === "[DONE]") continue;
        try { const j = JSON.parse(p); const dc = j.choices?.[0]?.delta?.content; if (dc) content += dc; if (j.usage) usage = j.usage; } catch {}
      }
    }
  } else {
    const j = JSON.parse(await r.text());
    content = j.choices?.[0]?.message?.content ?? "";
    usage = j.usage;
  }
  const { hits, n } = score(content);
  console.log(`[${model} stream=${stream}] status=${r.status} recall=${n}/5`, hits, "usage=", usage);
  console.log("  ->", JSON.stringify(content.slice(0, 300)), "\n");
}

for (const m of ["claude-sonnet-4-6", "claude-opus-4-7"]) {
  await run(m, false);
  await run(m, true);
}
