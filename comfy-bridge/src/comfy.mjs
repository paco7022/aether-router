// Cliente mínimo de la API HTTP de ComfyUI.
import { config } from "./config.mjs";

const CLIENT_ID = "aether-bridge";

async function request(path, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.comfyUrl + path, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function json(path, init, timeoutMs) {
  const res = await request(path, init, timeoutMs);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ComfyUI ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function systemStats() {
  return json("/system_stats", {}, 10_000);
}

// Nombres de archivo que ComfyUI tiene cargados, por tipo de loader. Se usa
// para marcar entradas del catálogo como no disponibles sin tener que abrir
// el filesystem.
export async function loadedFiles() {
  const info = await json("/object_info", {}, 120_000);
  const pick = (node, field) => {
    const spec = info?.[node]?.input?.required?.[field];
    const list = Array.isArray(spec) ? spec[0] : null;
    return new Set(Array.isArray(list) ? list : []);
  };
  return {
    checkpoints: pick("CheckpointLoaderSimple", "ckpt_name"),
    diffusion_models: pick("UNETLoader", "unet_name"),
    text_encoders: pick("CLIPLoader", "clip_name"),
    vae: pick("VAELoader", "vae_name"),
    loras: pick("LoraLoader", "lora_name"),
  };
}

export async function submitPrompt(graph) {
  const body = JSON.stringify({ prompt: graph, client_id: CLIENT_ID });
  const res = await request(
    "/prompt",
    { method: "POST", headers: { "content-type": "application/json" }, body },
    60_000,
  );
  const text = await res.text();
  if (!res.ok) {
    // ComfyUI devuelve 400 con {error:{message,details}, node_errors:{...}}
    // cuando el grafo es inválido. Ese detalle es lo único útil para depurar.
    let detail = text.slice(0, 800);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message
        ? `${parsed.error.message} ${JSON.stringify(parsed.error.details ?? "")} ${JSON.stringify(parsed.node_errors ?? {})}`.slice(0, 800)
        : detail;
    } catch {
      /* texto plano */
    }
    throw new Error(`ComfyUI rechazó el workflow: ${detail}`);
  }
  const parsed = JSON.parse(text);
  if (!parsed?.prompt_id) throw new Error("ComfyUI no devolvió prompt_id");
  return parsed.prompt_id;
}

export async function history(promptId) {
  const data = await json(`/history/${encodeURIComponent(promptId)}`, {}, 30_000);
  return data?.[promptId] || null;
}

export async function queueState() {
  const data = await json("/queue", {}, 10_000);
  return {
    running: (data?.queue_running || []).map((item) => item?.[1]).filter(Boolean),
    pending: (data?.queue_pending || []).map((item) => item?.[1]).filter(Boolean),
  };
}

export async function interrupt() {
  await request("/interrupt", { method: "POST" }, 10_000).catch(() => {});
}

export async function cancelQueued(promptId) {
  await request(
    "/queue",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    },
    10_000,
  ).catch(() => {});
}

export async function fetchAsset(ref) {
  const params = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || "",
    type: ref.type || "output",
  });
  const res = await request(`/view?${params}`, {}, 120_000);
  if (!res.ok) throw new Error(`No se pudo leer el asset ${ref.filename}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > config.maxAssetBytes) {
    throw new Error(`Asset ${ref.filename} excede maxAssetBytes (${buf.byteLength} bytes)`);
  }
  return {
    bytes: buf,
    contentType: res.headers.get("content-type") || guessType(ref.filename),
  };
}

// Sube una imagen al input/ de ComfyUI para que LoadImage la pueda usar
// (img2img e image-to-video). Devuelve el nombre con el que quedó guardada.
export async function uploadImage(bytes, filename, contentType) {
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: contentType || "image/png" }), filename);
  form.append("overwrite", "true");
  form.append("type", "input");
  const res = await request("/upload/image", { method: "POST", body: form }, 60_000);
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload a ComfyUI falló: ${res.status} ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text);
  const sub = parsed?.subfolder ? `${parsed.subfolder}/` : "";
  return `${sub}${parsed?.name || filename}`;
}

function guessType(filename) {
  const ext = String(filename).toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

// Recorre `outputs` del history y devuelve las referencias de archivo en el
// orden en que ComfyUI las emitió. Las claves varían por nodo (images para
// SaveImage, videos para SaveVideo, gifs para VideoHelperSuite).
export function collectOutputs(historyEntry) {
  const outputs = historyEntry?.outputs || {};
  const refs = [];
  for (const nodeId of Object.keys(outputs).sort((a, b) => Number(a) - Number(b))) {
    const node = outputs[nodeId] || {};
    for (const key of ["images", "videos", "gifs", "audio"]) {
      for (const ref of node[key] || []) {
        if (!ref?.filename) continue;
        // ComfyUI marca los previews temporales con type "temp"; solo
        // interesan los finales.
        if (ref.type && ref.type !== "output") continue;
        refs.push({ filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" });
      }
    }
  }
  return refs;
}

export function historyStatus(historyEntry) {
  const status = historyEntry?.status || {};
  if (status.status_str === "error" || status.completed === false) {
    const messages = status.messages || [];
    const errorMsg = messages
      .filter((m) => Array.isArray(m) && m[0] === "execution_error")
      .map((m) => {
        const d = m[1] || {};
        return `${d.node_type || "node"}: ${d.exception_type || ""} ${d.exception_message || ""}`.trim();
      })
      .join(" | ");
    return { done: true, ok: false, error: errorMsg || "La ejecución falló en ComfyUI" };
  }
  if (status.completed === true || status.status_str === "success") {
    return { done: true, ok: true, error: null };
  }
  return { done: false, ok: false, error: null };
}
