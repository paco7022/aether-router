// Smoke test del bridge: encola un job, espera y guarda el resultado.
//
//   BRIDGE_SECRET=... node scripts/smoke.mjs anime-xl "a red fox in the snow"
//
// Con --video usa los defaults de video. Guarda en ./out/.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = (process.env.BRIDGE_URL || "http://127.0.0.1:8189").replace(/\/+$/, "");
const secret = process.env.BRIDGE_SECRET || "";
const headers = { "x-aether-bridge-secret": secret, "content-type": "application/json" };

const [, , model = "anime-xl", ...promptParts] = process.argv;
const prompt = promptParts.join(" ") || "a red fox sitting in the snow, cinematic lighting";

async function api(pathname, init = {}) {
  const res = await fetch(base + pathname, { ...init, headers: { ...headers, ...init.headers } });
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("application/json")) {
    const body = await res.json();
    if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${JSON.stringify(body)}`);
    return body;
  }
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const started = Date.now();
const job = await api("/jobs", {
  method: "POST",
  body: JSON.stringify({ model, prompt, steps: process.env.STEPS ? Number(process.env.STEPS) : undefined }),
});
console.log(`job ${job.id} (${job.kind}) encolado`);

let current = job;
while (current.status === "queued" || current.status === "running") {
  await new Promise((r) => setTimeout(r, 1500));
  current = await api(`/jobs/${job.id}`);
  process.stdout.write(`\r${current.status} ${Math.round((Date.now() - started) / 1000)}s   `);
}
process.stdout.write("\n");

if (current.status !== "done") {
  console.error("FALLÓ:", current.error);
  process.exit(1);
}

await mkdir("out", { recursive: true });
for (const asset of current.assets) {
  const bytes = await api(asset.url);
  const ext = asset.content_type.split("/")[1].replace("jpeg", "jpg");
  const file = path.join("out", `${model}-${job.id.slice(0, 8)}-${asset.index}.${ext}`);
  await writeFile(file, bytes);
  console.log(`guardado ${file} (${(asset.size / 1024).toFixed(0)} KB)`);
}
console.log(`total ${Math.round((Date.now() - started) / 1000)}s · seed ${current.seed}`);
