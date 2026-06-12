// Smoke-test the Orbit adapter directly (no Supabase, no auth).
// Runs the same TS module Aether uses in production through a
// minimal ProviderRequest, both non-stream and stream, and prints
// chars + first chunk so the `<` character can be visually verified.
//
// Run: node scripts/test-orbit-adapter.mjs

// Run with: npx tsx scripts/test-orbit-adapter.mjs

if (!process.env.ORBIT_API_KEY) {
  console.error("ORBIT_API_KEY is required. Set it in your env before running this smoke-test.");
  process.exit(1);
}

const { orbitProvider } = await import("../src/lib/providers/orbit.ts");

const PROMPT_CODE =
  "Write exactly: `type Box<T> = { value: T }; const f = <T>(x: Box<T>): T => x.value;` then on a new line: `1 < 2 < 3 and <div>hi</div>` Nothing else.";

async function nonStream(model) {
  const r = await orbitProvider.forward({
    model,
    messages: [{ role: "user", content: PROMPT_CODE }],
    max_tokens: 200,
    temperature: 0,
    stream: false,
  });
  const ct = r.headers.get("content-type");
  const text = await r.text();
  console.log(`\n[NON-STREAM ${model}] status=${r.status} ct=${ct}`);
  try {
    const j = JSON.parse(text);
    const content = j.choices?.[0]?.message?.content ?? "";
    console.log("  finish_reason=", j.choices?.[0]?.finish_reason);
    console.log("  usage=", j.usage);
    console.log("  content len=", content.length, "  `<` count=", (content.match(/</g) || []).length);
    console.log("  content:", JSON.stringify(content));
  } catch {
    console.log("  raw:", text.slice(0, 400));
  }
}

async function stream(model) {
  const r = await orbitProvider.forward({
    model,
    messages: [{ role: "user", content: PROMPT_CODE }],
    max_tokens: 200,
    temperature: 0,
    stream: true,
  });
  console.log(`\n[STREAM ${model}] status=${r.status} ct=${r.headers.get("content-type")}`);
  if (!r.body) {
    console.log("  no body");
    return;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let combined = "";
  let lastFinish = null;
  let usage = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 2);
      if (!block.startsWith("data:")) continue;
      const payload = block.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const dc = j.choices?.[0]?.delta?.content;
        if (typeof dc === "string") combined += dc;
        const fr = j.choices?.[0]?.finish_reason;
        if (fr) lastFinish = fr;
        if (j.usage) usage = j.usage;
      } catch {}
    }
  }
  console.log("  finish_reason=", lastFinish);
  console.log("  usage=", usage);
  console.log("  combined len=", combined.length, "  `<` count=", (combined.match(/</g) || []).length);
  console.log("  combined:", JSON.stringify(combined));
}

console.log("Testing Orbit adapter...");
await nonStream("claude-sonnet-4-6");
await stream("claude-sonnet-4-6");
await nonStream("glm-5-agentic");
console.log("\nDone.");
