// Cola de jobs con concurrencia 1 (hay una sola GPU).
//
// Los jobs viven en memoria: si el bridge se reinicia, el router los ve como
// perdidos y refunda. Persistir acá sería duplicar el estado que ya guarda
// Supabase en `media_jobs`.

import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import * as comfy from "./comfy.mjs";
import { buildGraph } from "./workflows.mjs";

const jobs = new Map();
const waiting = [];
let running = 0;

export class QueueFullError extends Error {
  constructor() {
    super("La cola de generación está llena");
    this.name = "QueueFullError";
  }
}

export function createJob({ entry, params, initImage }) {
  if (waiting.length >= config.maxQueue) throw new QueueFullError();

  const job = {
    id: randomUUID(),
    entryId: entry.id,
    kind: entry.kind,
    status: "queued",
    params,
    initImage: initImage || null,
    promptId: null,
    progress: { value: 0, max: 0 },
    assets: [],
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    expiresAt: null,
    canceled: false,
    _entry: entry,
  };

  jobs.set(job.id, job);
  waiting.push(job.id);
  pump();
  return job;
}

export function getJob(id) {
  return jobs.get(String(id || "")) || null;
}

export function queuePosition(job) {
  if (job.status !== "queued") return 0;
  const idx = waiting.indexOf(job.id);
  return idx < 0 ? 0 : idx + 1;
}

export async function cancelJob(job) {
  if (job.status === "done" || job.status === "error") return false;
  job.canceled = true;

  const idx = waiting.indexOf(job.id);
  if (idx >= 0) waiting.splice(idx, 1);

  if (job.promptId) {
    await comfy.cancelQueued(job.promptId);
    if (job.status === "running") await comfy.interrupt();
  }

  finish(job, { status: "error", error: "Cancelado" });
  return true;
}

export function stats() {
  return {
    running,
    queued: waiting.length,
    tracked: jobs.size,
    concurrency: config.concurrency,
    max_queue: config.maxQueue,
  };
}

function finish(job, { status, error }) {
  job.status = status;
  job.error = error ?? null;
  job.finishedAt = Date.now();
  job.expiresAt = job.finishedAt + config.jobTtlMs;
  // Los bytes de entrada ya no hacen falta; el asset de salida sí se guarda
  // hasta que el router lo baje.
  job.initImage = null;
}

function pump() {
  while (running < config.concurrency && waiting.length > 0) {
    const id = waiting.shift();
    const job = jobs.get(id);
    if (!job || job.canceled) continue;
    running += 1;
    runJob(job)
      .catch((err) => {
        finish(job, { status: "error", error: String(err?.message || err) });
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

async function runJob(job) {
  job.status = "running";
  job.startedAt = Date.now();

  // La imagen inicial se sube recién ahora: si el job se cancela en cola,
  // nunca tocó el disco de ComfyUI.
  if (job.initImage) {
    const name = await comfy.uploadImage(
      job.initImage.bytes,
      `aether-init-${job.id}.${job.initImage.ext || "png"}`,
      job.initImage.contentType,
    );
    job.params = { ...job.params, init_image_name: name };
  }

  const { graph } = buildGraph(job._entry, job.params);
  if (job.canceled) return;

  job.promptId = await comfy.submitPrompt(graph);

  const deadline = Date.now() + config.jobTimeoutMs;
  let entryHistory = null;

  while (Date.now() < deadline) {
    if (job.canceled) return;
    await sleep(900);

    entryHistory = await comfy.history(job.promptId).catch(() => null);
    if (!entryHistory) continue;

    const state = comfy.historyStatus(entryHistory);
    if (!state.done) continue;
    if (!state.ok) {
      finish(job, { status: "error", error: state.error });
      return;
    }
    break;
  }

  if (job.canceled) return;

  if (!entryHistory || !comfy.historyStatus(entryHistory).done) {
    await comfy.cancelQueued(job.promptId);
    await comfy.interrupt();
    finish(job, { status: "error", error: "Timeout de generación" });
    return;
  }

  const refs = comfy.collectOutputs(entryHistory);
  if (refs.length === 0) {
    finish(job, { status: "error", error: "ComfyUI terminó sin producir archivos" });
    return;
  }

  const assets = [];
  for (let i = 0; i < refs.length; i += 1) {
    const asset = await comfy.fetchAsset(refs[i]);
    assets.push({
      index: i,
      filename: refs[i].filename,
      contentType: asset.contentType,
      bytes: asset.bytes,
      size: asset.bytes.byteLength,
    });
  }

  job.assets = assets;
  finish(job, { status: "done", error: null });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Libera los bytes de jobs viejos. Un job terminado sin recoger no debe
// mantener 90MB de video en RAM para siempre.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const stale = job.expiresAt && job.expiresAt < now;
    const abandoned = !job.expiresAt && now - job.createdAt > config.jobTimeoutMs * 2;
    if (stale || abandoned) jobs.delete(id);
  }
}, 60_000);
sweeper.unref?.();
