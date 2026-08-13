// Orquestación de jobs de imagen/video.
//
// Reparto de responsabilidades:
//   - comfy-bridge (la PC): ejecuta y guarda el resultado en RAM un rato.
//   - esta capa: cobra, persiste en `media_jobs`, baja el archivo al Storage
//     de Supabase y refunda si algo sale mal.
//
// No hay worker de fondo: el avance lo empuja quien consulta el job (el poll
// del dashboard o el wrapper síncrono de /v1/images/generations). Es lo único
// que funciona igual en el nodo PC y en Cloudflare Workers, donde no existe
// proceso persistente.

import { createAdminClient } from "@/lib/supabase/admin";
import { mediaCredits } from "@/lib/media-credits";
import { creditsToUsd } from "@/lib/credits";
import {
  BridgeError,
  cancelBridgeJob,
  fetchBridgeAsset,
  getBridgeJob,
  isBridgeConfigured,
  submitBridgeJob,
  type BridgeJob,
} from "@/lib/comfy-bridge";
import { moderateMessages, recordModerationReview } from "@/lib/content-moderation";
import type { ApiKeyInfo } from "@/lib/auth";

const MEDIA_PROVIDER = "comfy";
const BUCKET = "media";
// Jobs abiertos en simultáneo por usuario. La GPU es una sola: dejar que
// alguien encole 50 clips de video haría esperar a todos los demás.
const MAX_OPEN_JOBS = Number(process.env.MEDIA_MAX_OPEN_JOBS) || 3;
// Un job que nadie pudo reconciliar en este tiempo se da por perdido y se
// refunda (típicamente: el bridge se reinició a mitad de generación).
const JOB_STALE_MS = 20 * 60 * 1000;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
// Promo opcional: abre media al plan free sin tocar código.
const MEDIA_FREE_ENABLED = process.env.AETHER_MEDIA_FREE_ENABLED === "true";

export interface MediaModelRow {
  id: string;
  provider: string;
  upstream_model_id: string;
  display_name: string;
  is_active: boolean;
  modality: string;
  media_base_credits: number;
  media_base_pixels: number | null;
  media_base_steps: number | null;
  media_base_frames: number | null;
  media_config: MediaConfig | null;
}

export interface MediaConfig {
  defaults?: Record<string, number | string>;
  limits?: Record<string, number>;
  supports?: Record<string, boolean>;
}

export interface MediaJobRow {
  id: string;
  user_id: string;
  api_key_id: string | null;
  model_id: string;
  kind: "image" | "video";
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  bridge_job_id: string | null;
  prompt: string;
  negative_prompt: string | null;
  params: Record<string, unknown>;
  seed: number | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  frames: number | null;
  credits_reserved: number;
  credits_charged: number;
  refunded: boolean;
  assets: MediaAsset[];
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface MediaAsset {
  path: string;
  content_type: string;
  size: number;
}

export class MediaError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.name = "MediaError";
    this.status = status;
    this.code = code;
  }
}

// ── Normalización de parámetros ───────────────────────────────
// Espejo (más laxo) de comfy-bridge/src/workflows.mjs: el bridge sigue siendo
// la autoridad, pero acá hay que conocer las dimensiones finales para cobrar
// lo correcto antes de encolar.

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface NormalizedParams {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  batch: number;
  seed: number | null;
  sampler?: string;
  scheduler?: string;
  guidance?: number;
  denoise?: number;
  length?: number;
  fps?: number;
  shift?: number;
  loras?: { name: string; strength: number }[];
}

export function normalizeMediaParams(
  model: MediaModelRow,
  raw: Record<string, unknown>,
): NormalizedParams {
  const config = model.media_config || {};
  const defaults = config.defaults || {};
  const limits = config.limits || {};
  const isVideo = model.modality === "video";

  const prompt = String(raw.prompt ?? "").trim();
  if (!prompt) throw new MediaError("prompt is required");
  if (prompt.length > 6000) throw new MediaError("prompt exceeds 6000 characters");

  const negative = String(raw.negative_prompt ?? defaults.negative_prompt ?? "").trim();
  if (negative.length > 6000) throw new MediaError("negative_prompt exceeds 6000 characters");

  // `size` estilo OpenAI ("1024x1024") gana sobre width/height sueltos.
  let width = numberOr(raw.width, Number(defaults.width) || 1024);
  let height = numberOr(raw.height, Number(defaults.height) || 1024);
  if (typeof raw.size === "string" && /^\d+x\d+$/.test(raw.size)) {
    const [w, h] = raw.size.split("x").map(Number);
    width = w;
    height = h;
  }

  const sizeStep = isVideo ? 32 : 8;
  width = clamp(roundTo(width, sizeStep), 256, 2048);
  height = clamp(roundTo(height, sizeStep), 256, 2048);

  const maxPixels = Number(limits.maxPixels) || 1024 * 1024;
  if (width * height > maxPixels) {
    const factor = Math.sqrt(maxPixels / (width * height));
    width = clamp(roundTo(width * factor, sizeStep), 256, 2048);
    height = clamp(roundTo(height * factor, sizeStep), 256, 2048);
  }

  const steps = clamp(
    Math.round(numberOr(raw.steps, Number(defaults.steps) || 20)),
    1,
    Number(limits.maxSteps) || 50,
  );
  const batch = clamp(
    Math.round(numberOr(raw.batch ?? raw.n, 1)),
    1,
    Number(limits.maxBatch) || 1,
  );
  const cfg = clamp(numberOr(raw.cfg, Number(defaults.cfg) || 1), 0, 20);

  const params: NormalizedParams = {
    prompt,
    negative_prompt: negative,
    width,
    height,
    steps,
    cfg,
    batch,
    seed: raw.seed === undefined || raw.seed === null ? null : Math.abs(Math.round(Number(raw.seed))),
  };

  if (typeof raw.sampler === "string") params.sampler = raw.sampler;
  if (typeof raw.scheduler === "string") params.scheduler = raw.scheduler;
  if (raw.guidance !== undefined) params.guidance = clamp(numberOr(raw.guidance, 3.5), 0, 20);
  if (raw.denoise !== undefined) params.denoise = clamp(numberOr(raw.denoise, 0.6), 0.05, 1);

  if (Array.isArray(raw.loras)) {
    params.loras = raw.loras
      .slice(0, 4)
      .map((l) => {
        const lora = l as { name?: unknown; strength?: unknown };
        return { name: String(lora?.name ?? "").trim(), strength: clamp(numberOr(lora?.strength, 1), -4, 4) };
      })
      .filter((l) => l.name);
  }

  if (isVideo) {
    const rawLength = numberOr(raw.length ?? raw.frames, Number(defaults.length) || 49);
    const snapped = Math.round((rawLength - 1) / 4) * 4 + 1;
    params.length = clamp(snapped, 5, Number(limits.maxLength) || 81);
    params.fps = clamp(numberOr(raw.fps, Number(defaults.fps) || 24), 1, 60);
    params.shift = clamp(numberOr(raw.shift, Number(defaults.shift) || 3), 0, 100);
    params.batch = 1;
  }

  return params;
}

export function priceOf(model: MediaModelRow, params: NormalizedParams): number {
  return mediaCredits(model, {
    width: params.width,
    height: params.height,
    steps: params.steps,
    batch: params.batch,
    frames: params.length ?? null,
  });
}

// ── Lookup de modelo ──────────────────────────────────────────

export async function getMediaModel(modelId: string): Promise<MediaModelRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("models")
    .select(
      "id, provider, upstream_model_id, display_name, is_active, modality, media_base_credits, media_base_pixels, media_base_steps, media_base_frames, media_config",
    )
    .eq("id", modelId)
    .eq("is_active", true)
    .single();

  if (!data) return null;
  const row = data as unknown as MediaModelRow;
  if (row.provider !== MEDIA_PROVIDER) return null;
  if (row.modality !== "image" && row.modality !== "video") return null;
  return row;
}

export async function listMediaModels(): Promise<MediaModelRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("models")
    .select(
      "id, provider, upstream_model_id, display_name, is_active, modality, media_base_credits, media_base_pixels, media_base_steps, media_base_frames, media_config",
    )
    .eq("is_active", true)
    .eq("provider", MEDIA_PROVIDER)
    .order("id");
  return (data as unknown as MediaModelRow[]) || [];
}

// ── Creación ──────────────────────────────────────────────────

export async function createMediaJob(
  keyInfo: ApiKeyInfo,
  body: Record<string, unknown>,
): Promise<MediaJobRow> {
  if (!isBridgeConfigured()) {
    throw new MediaError("Image generation is not enabled on this deployment", 503, "not_configured");
  }

  const modelId = String(body.model ?? "").trim();
  if (!modelId) throw new MediaError("model is required");

  const model = await getMediaModel(modelId);
  if (!model) throw new MediaError("Model not found or unavailable", 404, "model_not_found");

  // Plan de pago (o promo abierta). Las claves custom traen su propio
  // presupuesto, así que no se les aplica la regla de plan.
  if (!MEDIA_FREE_ENABLED && !keyInfo.isCustom && keyInfo.planId === "free") {
    throw new MediaError(
      "Image and video generation require a paid plan.",
      402,
      "paid_plan_required",
    );
  }

  if (keyInfo.allowedProviders && !keyInfo.allowedProviders.includes(MEDIA_PROVIDER)) {
    throw new MediaError("This API key cannot use image generation", 403, "provider_not_allowed");
  }

  const supabase = createAdminClient();

  const { count: openJobs } = await supabase
    .from("media_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", keyInfo.userId)
    .in("status", ["queued", "running"]);

  if ((openJobs ?? 0) >= MAX_OPEN_JOBS) {
    throw new MediaError(
      `You already have ${MAX_OPEN_JOBS} generations in progress. Wait for one to finish.`,
      429,
      "too_many_jobs",
    );
  }

  const params = normalizeMediaParams(model, body);

  // Moderación antes de tocar créditos o la GPU. A diferencia del chat —donde
  // un flag solo encola revisión— acá se BLOQUEA: generar la imagen sería
  // producir el material, no enrutarlo.
  const moderation = await moderateMessages([{ role: "user", content: params.prompt }]);
  if (moderation.flagged) {
    await recordModerationReview({
      userId: keyInfo.userId,
      source: keyInfo.source,
      flaggedItems: moderation.flaggedItems,
      messages: [{ role: "user", content: params.prompt }],
    });
    throw new MediaError("This prompt was rejected by the content policy", 403, "content_policy");
  }

  const credits = priceOf(model, params);
  if (credits <= 0) {
    throw new MediaError("This model has no price configured", 503, "model_misconfigured");
  }

  const { data: newBalance, error: deductErr } = await supabase.rpc("deduct_credits", {
    p_user_id: keyInfo.userId,
    p_amount: credits,
  });

  if (deductErr || newBalance === -1) {
    throw new MediaError(
      `Insufficient credits: this generation costs ${credits} credits`,
      402,
      "insufficient_credits",
    );
  }

  const initImage = typeof body.init_image === "string" ? body.init_image : null;

  const { data: inserted, error: insertErr } = await supabase
    .from("media_jobs")
    .insert({
      user_id: keyInfo.userId,
      api_key_id: keyInfo.keyId,
      model_id: model.id,
      kind: model.modality,
      status: "queued",
      prompt: params.prompt,
      negative_prompt: params.negative_prompt || null,
      // init_image NO se guarda: pesa megabytes y ya se envió al bridge.
      params: { ...params, init_image: undefined },
      seed: params.seed,
      width: params.width,
      height: params.height,
      steps: params.steps,
      frames: params.length ?? null,
      credits_reserved: credits,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    await refundCredits(keyInfo.userId, credits);
    throw new MediaError("Could not queue the generation", 500, "server_error");
  }

  const row = inserted as unknown as MediaJobRow;

  try {
    const bridgeJob = await submitBridgeJob({
      model: model.upstream_model_id,
      ...params,
      init_image: initImage,
    });

    const { data: updated } = await supabase
      .from("media_jobs")
      .update({
        bridge_job_id: bridgeJob.id,
        status: bridgeJob.status === "running" ? "running" : "queued",
        seed: bridgeJob.seed ?? row.seed,
        width: bridgeJob.width ?? row.width,
        height: bridgeJob.height ?? row.height,
        steps: bridgeJob.steps ?? row.steps,
        frames: bridgeJob.length ?? row.frames,
      })
      .eq("id", row.id)
      .select("*")
      .single();

    return (updated as unknown as MediaJobRow) || row;
  } catch (err) {
    // El bridge rechazó o está caído: devolver los créditos ya.
    await failJob(row, err instanceof Error ? err.message : "The image engine rejected the job");
    if (err instanceof BridgeError) {
      throw new MediaError(err.message, err.status, err.code);
    }
    throw new MediaError("The image engine is unavailable", 503, "engine_offline");
  }
}

// ── Reconciliación ────────────────────────────────────────────

/**
 * Avanza el estado del job consultando al bridge. Idempotente: dos polls
 * concurrentes suben los mismos archivos a las mismas rutas (upsert) y solo
 * uno gana el UPDATE condicional que liquida los créditos.
 */
export async function reconcileMediaJob(row: MediaJobRow): Promise<MediaJobRow> {
  if (row.status === "succeeded" || row.status === "failed" || row.status === "canceled") {
    return row;
  }

  const ageMs = Date.now() - new Date(row.created_at).getTime();

  if (!row.bridge_job_id) {
    // Nunca llegó a encolarse en la GPU (crash entre el insert y el submit).
    if (ageMs > 60_000) return failJob(row, "The generation was never queued");
    return row;
  }

  let bridgeJob: BridgeJob | null;
  try {
    bridgeJob = await getBridgeJob(row.bridge_job_id);
  } catch {
    // Túnel caído: no se toca el job todavía, salvo que ya sea muy viejo.
    if (ageMs > JOB_STALE_MS) return failJob(row, "The image engine went offline");
    return row;
  }

  if (!bridgeJob) {
    return failJob(row, "The image engine restarted and lost this generation");
  }

  if (bridgeJob.status === "queued" || bridgeJob.status === "running") {
    if (ageMs > JOB_STALE_MS) {
      await cancelBridgeJob(row.bridge_job_id);
      return failJob(row, "The generation timed out");
    }
    if (bridgeJob.status === "running" && row.status !== "running") {
      return updateJob(row, { status: "running" });
    }
    return row;
  }

  if (bridgeJob.status === "error") {
    return failJob(row, bridgeJob.error || "The generation failed");
  }

  return finalizeJob(row, bridgeJob);
}

async function finalizeJob(row: MediaJobRow, bridgeJob: BridgeJob): Promise<MediaJobRow> {
  const supabase = createAdminClient();
  const assets: MediaAsset[] = [];

  for (const asset of bridgeJob.assets) {
    const { bytes, contentType } = await fetchBridgeAsset(bridgeJob.id, asset.index);
    const ext = extensionFor(contentType);
    // Ruta determinística: si dos polls finalizan a la vez, el upsert
    // sobrescribe el mismo objeto en vez de duplicar archivos.
    const path = `${row.user_id}/${row.id}/${asset.index}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (uploadErr) {
      console.error("media: upload failed", uploadErr.message);
      return failJob(row, "Could not store the generated file");
    }

    assets.push({ path, content_type: contentType, size: bytes.byteLength });
  }

  // Se cobra sobre lo que la GPU realmente hizo: el bridge puede haber
  // recortado tamaño o steps por sus propios límites, y en ese caso el usuario
  // paga menos. Nunca más que lo reservado.
  const charged = await settledCredits(row, bridgeJob);
  const durationMs =
    bridgeJob.finished_at && bridgeJob.created_at ? bridgeJob.finished_at - bridgeJob.created_at : null;

  // UPDATE condicional: solo el primer poll que llegue liquida.
  const { data: updated } = await supabase
    .from("media_jobs")
    .update({
      status: "succeeded",
      assets,
      credits_charged: charged,
      seed: bridgeJob.seed ?? row.seed,
      width: bridgeJob.width ?? row.width,
      height: bridgeJob.height ?? row.height,
      steps: bridgeJob.steps ?? row.steps,
      frames: bridgeJob.length ?? row.frames,
      duration_ms: durationMs,
      finished_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .in("status", ["queued", "running"])
    .select("*")
    .single();

  if (!updated) {
    // Otro poll ganó la carrera: devolver el estado ya liquidado.
    const { data: current } = await supabase.from("media_jobs").select("*").eq("id", row.id).single();
    return (current as unknown as MediaJobRow) || row;
  }

  // La diferencia entre lo reservado y lo cobrado vuelve al usuario. Va
  // después del UPDATE condicional para que un segundo poll no la duplique.
  const overcharge = row.credits_reserved - charged;
  if (overcharge > 0) await refundCredits(row.user_id, overcharge);

  await logMediaUsage(updated as unknown as MediaJobRow, charged, durationMs, "success");
  return updated as unknown as MediaJobRow;
}

/**
 * Créditos finales de un job exitoso: el precio recalculado con las dimensiones
 * que reportó el bridge, tope en lo reservado. Si el modelo desapareció de la
 * tabla entre encolar y terminar, se cobra lo reservado.
 */
async function settledCredits(row: MediaJobRow, bridgeJob: BridgeJob): Promise<number> {
  const model = await getMediaModel(row.model_id);
  if (!model) return row.credits_reserved;

  const params = row.params as unknown as NormalizedParams;
  const actual = mediaCredits(model, {
    width: bridgeJob.width ?? row.width ?? 0,
    height: bridgeJob.height ?? row.height ?? 0,
    steps: bridgeJob.steps ?? row.steps ?? 0,
    batch: params?.batch ?? 1,
    frames: bridgeJob.length ?? row.frames ?? null,
  });

  if (actual <= 0) return row.credits_reserved;
  return Math.min(actual, row.credits_reserved);
}

async function updateJob(row: MediaJobRow, patch: Record<string, unknown>): Promise<MediaJobRow> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("media_jobs")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  return (data as unknown as MediaJobRow) || row;
}

export async function failJob(row: MediaJobRow, message: string): Promise<MediaJobRow> {
  const supabase = createAdminClient();

  // El refund va atado al mismo UPDATE condicional que cierra el job, así que
  // no se puede refundar dos veces por más polls concurrentes que haya.
  const { data: updated } = await supabase
    .from("media_jobs")
    .update({
      status: "failed",
      error: message,
      refunded: row.credits_reserved > 0,
      credits_charged: 0,
      finished_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .in("status", ["queued", "running"])
    .select("*")
    .single();

  if (!updated) {
    const { data: current } = await supabase.from("media_jobs").select("*").eq("id", row.id).single();
    return (current as unknown as MediaJobRow) || row;
  }

  if (row.credits_reserved > 0) {
    await refundCredits(row.user_id, row.credits_reserved);
  }

  await logMediaUsage(updated as unknown as MediaJobRow, 0, null, "error");
  return updated as unknown as MediaJobRow;
}

export async function cancelMediaJob(row: MediaJobRow): Promise<MediaJobRow> {
  if (row.bridge_job_id) await cancelBridgeJob(row.bridge_job_id);
  const canceled = await failJob(row, "Canceled by the user");
  if (canceled.status === "failed") {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("media_jobs")
      .update({ status: "canceled" })
      .eq("id", row.id)
      .eq("status", "failed")
      .select("*")
      .single();
    return (data as unknown as MediaJobRow) || canceled;
  }
  return canceled;
}

async function refundCredits(userId: string, amount: number): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("add_credits", { p_user_id: userId, p_amount: amount });
  if (error) console.error("media: refund failed", error.message);
}

// Los jobs de media aparecen en /dashboard/usage como cualquier otro consumo:
// 0 tokens, N créditos.
async function logMediaUsage(
  row: MediaJobRow,
  credits: number,
  durationMs: number | null,
  status: "success" | "error",
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("log_usage_and_tx", {
    p_user_id: row.user_id,
    p_api_key_id: row.api_key_id,
    p_model_id: row.model_id,
    p_prompt_tokens: 0,
    p_completion_tokens: 0,
    p_total_tokens: 0,
    p_credits_charged: credits,
    p_cost_usd: creditsToUsd(credits),
    p_status: status,
    p_duration_ms: durationMs,
    p_premium_cost: 0,
    p_cache_read_tokens: 0,
    p_cache_write_tokens: 0,
    p_source: row.api_key_id ? "api" : "chat",
    p_estimated_prompt_tokens: 0,
    p_finish_reason: null,
    p_tx_amount: credits > 0 ? -credits : null,
    p_tx_balance: null,
    p_tx_type: credits > 0 ? "media_generation" : null,
    p_tx_description: credits > 0 ? `${row.model_id} - ${row.kind} generation` : null,
  });
  if (error) console.error("media: usage log failed", error.message);
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("webm")) return "webm";
  return "bin";
}

// ── Serialización ─────────────────────────────────────────────

export interface SerializedJob {
  id: string;
  model: string;
  kind: string;
  status: string;
  prompt: string;
  negative_prompt: string | null;
  seed: number | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  frames: number | null;
  credits: number;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
  assets: { url: string | null; content_type: string; size: number }[];
}

export async function serializeJob(row: MediaJobRow): Promise<SerializedJob> {
  const assets = await signAssets(row.assets || []);
  return {
    id: row.id,
    model: row.model_id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    negative_prompt: row.negative_prompt,
    seed: row.seed,
    width: row.width,
    height: row.height,
    steps: row.steps,
    frames: row.frames,
    credits: row.status === "succeeded" ? row.credits_charged : row.credits_reserved,
    error: row.error,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
    finished_at: row.finished_at,
    assets,
  };
}

export async function signAssets(
  assets: MediaAsset[],
): Promise<{ url: string | null; content_type: string; size: number }[]> {
  if (!assets || assets.length === 0) return [];
  const supabase = createAdminClient();
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(assets.map((a) => a.path), SIGNED_URL_TTL_SECONDS);

  return assets.map((asset, i) => ({
    url: data?.[i]?.signedUrl ?? null,
    content_type: asset.content_type,
    size: asset.size,
  }));
}

export async function downloadAsset(asset: MediaAsset): Promise<ArrayBuffer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(asset.path);
  if (error || !data) return null;
  return data.arrayBuffer();
}
