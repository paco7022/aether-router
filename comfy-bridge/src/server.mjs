// Servidor HTTP del bridge. Único cliente esperado: aether-router.
//
// Escucha en 127.0.0.1 y se publica por cloudflared; ComfyUI nunca queda
// expuesto directo a internet.

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config, assertConfig } from "./config.mjs";
import { getCatalog, getEntry, requiredFiles, publicEntry } from "./catalog.mjs";
import { normalizeParams, ValidationError } from "./workflows.mjs";
import * as comfy from "./comfy.mjs";
import { createJob, getJob, cancelJob, queuePosition, stats, QueueFullError } from "./queue.mjs";

assertConfig();

const MAX_INIT_IMAGE_BYTES = 12 * 1024 * 1024;

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": Buffer.isBuffer(body) ? headers["content-type"] : "application/json",
    "content-length": payload.byteLength,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function fail(res, status, message, code = "bridge_error") {
  send(res, status, { error: { message, code } });
}

function authorized(req) {
  const header =
    req.headers["x-aether-bridge-secret"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const given = Buffer.from(String(header || ""));
  const expected = Buffer.from(config.secret);
  if (given.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(given, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        reject(new ValidationError("Body demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (raw.byteLength === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ValidationError("JSON inválido");
  }
}

function detectImage(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { contentType: "image/png", ext: "png" };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes.length > 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}

function parseInitImage(raw) {
  if (!raw) return null;
  const base64 = String(raw).includes(",") && String(raw).startsWith("data:")
    ? String(raw).split(",", 2)[1]
    : String(raw);
  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new ValidationError("init_image no es base64 válido");
  }
  if (bytes.byteLength === 0) throw new ValidationError("init_image vacío");
  if (bytes.byteLength > MAX_INIT_IMAGE_BYTES) {
    throw new ValidationError("init_image supera 12MB");
  }
  // Confiar en el content-type declarado no sirve de nada: se valida el
  // magic-byte real, igual que el upload del chat del dashboard.
  const kind = detectImage(bytes);
  if (!kind) throw new ValidationError("init_image debe ser PNG, JPEG o WebP");
  return { bytes, ...kind };
}

function jobView(job) {
  return {
    id: job.id,
    model: job.entryId,
    kind: job.kind,
    status: job.status,
    queue_position: queuePosition(job),
    error: job.error,
    created_at: job.createdAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    seed: job.params?.seed ?? null,
    width: job.params?.width ?? null,
    height: job.params?.height ?? null,
    steps: job.params?.steps ?? null,
    length: job.params?.length ?? null,
    fps: job.params?.fps ?? null,
    assets: job.assets.map((a) => ({
      index: a.index,
      content_type: a.contentType,
      size: a.size,
      url: `/jobs/${job.id}/assets/${a.index}`,
    })),
  };
}

async function handleCatalog(res) {
  let catalog = null;
  try {
    catalog = await getCatalog();
  } catch {
    // ComfyUI caído: no hay lista de archivos, así que tampoco hay catálogo.
    return send(res, 200, { comfy_reachable: false, models: [], loras: [] });
  }

  const data = catalog.entries.map((entry) =>
    publicEntry(
      entry,
      requiredFiles(entry).every(({ folder, name }) => catalog.files?.[folder]?.has(name)),
    ),
  );

  send(res, 200, { comfy_reachable: true, models: data, loras: catalog.loras });
}

async function handleHealth(res) {
  let comfyStats = null;
  let comfyOk = true;
  try {
    comfyStats = await comfy.systemStats();
  } catch {
    comfyOk = false;
  }

  const device = comfyStats?.devices?.[0] || null;
  send(res, comfyOk ? 200 : 503, {
    ok: comfyOk,
    comfy_url: config.comfyUrl,
    comfy_version: comfyStats?.system?.comfyui_version ?? null,
    gpu: device
      ? {
          name: device.name,
          vram_total: device.vram_total,
          vram_free: device.vram_free,
        }
      : null,
    queue: stats(),
  });
}

async function handleCreateJob(req, res) {
  const body = await readJson(req);
  const entry = await getEntry(body.model);
  if (!entry) return fail(res, 404, `Modelo desconocido: ${body.model}`, "unknown_model");

  const files = await getCatalog().then((c) => c.files).catch(() => null);
  const available = requiredFiles(entry).every(({ folder, name }) => files?.[folder]?.has(name));
  if (!available) {
    return fail(res, 503, `El modelo ${entry.id} no está disponible en la GPU`, "model_unavailable");
  }

  const initImage = parseInitImage(body.init_image);
  if (initImage && entry.kind === "image" && !entry.supports?.img2img) {
    return fail(res, 400, `${entry.id} no soporta img2img`, "invalid_request");
  }
  if (initImage && entry.kind === "video" && !entry.supports?.i2v) {
    return fail(res, 400, `${entry.id} no soporta image-to-video`, "invalid_request");
  }

  // `init_image_name` real se resuelve al subir la imagen, pero normalizeParams
  // necesita saber si hay una para decidir denoise.
  const params = normalizeParams(entry, {
    ...body,
    init_image_name: initImage ? "pending" : null,
  });
  if (initImage) params.init_image_name = null;

  if (params.loras.length > 0) {
    const known = files?.loras;
    const missing = params.loras.filter((l) => known && !known.has(l.name)).map((l) => l.name);
    if (missing.length > 0) {
      return fail(res, 400, `LoRA no encontrada: ${missing.join(", ")}`, "invalid_request");
    }
  }

  const job = createJob({ entry, params, initImage });
  send(res, 202, jobView(job));
}

function handleGetAsset(res, job, indexRaw) {
  if (job.status !== "done") return fail(res, 409, "El job todavía no terminó", "not_ready");
  const index = Number(indexRaw);
  const asset = job.assets.find((a) => a.index === index);
  if (!asset) return fail(res, 404, "Asset inexistente", "not_found");
  send(res, 200, asset.bytes, { "content-type": asset.contentType });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    // Ping sin auth para el health check del túnel.
    if (req.method === "GET" && path === "/ping") return send(res, 200, { ok: true });

    if (!authorized(req)) return fail(res, 401, "Secreto inválido", "unauthorized");

    if (req.method === "GET" && path === "/health") return await handleHealth(res);
    if (req.method === "GET" && path === "/catalog") return await handleCatalog(res);
    if (req.method === "POST" && path === "/jobs") return await handleCreateJob(req, res);

    const jobMatch = path.match(/^\/jobs\/([^/]+)(?:\/assets\/(\d+))?$/);
    if (jobMatch) {
      const job = getJob(jobMatch[1]);
      if (!job) return fail(res, 404, "Job inexistente o expirado", "not_found");
      if (req.method === "GET" && jobMatch[2] !== undefined) {
        return handleGetAsset(res, job, jobMatch[2]);
      }
      if (req.method === "GET") return send(res, 200, jobView(job));
      if (req.method === "DELETE") {
        await cancelJob(job);
        return send(res, 200, jobView(job));
      }
    }

    return fail(res, 404, "Ruta desconocida", "not_found");
  } catch (err) {
    if (err instanceof ValidationError) return fail(res, 400, err.message, "invalid_request");
    if (err instanceof QueueFullError) return fail(res, 429, err.message, "queue_full");
    console.error("[bridge] error:", err);
    return fail(res, 500, String(err?.message || err));
  }
});

server.headersTimeout = 65_000;
server.requestTimeout = 0; // los assets grandes pueden tardar en drenar

server.listen(config.port, config.host, () => {
  console.log(
    `[bridge] escuchando en http://${config.host}:${config.port} -> ComfyUI ${config.comfyUrl}`,
  );
});
