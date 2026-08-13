// Cliente del comfy-bridge (la PC con la RTX 5090).
//
// El bridge se publica por cloudflared en su propio hostname, así que esto
// funciona igual desde el nodo PC o desde la app en Cloudflare. Si
// COMFY_BRIDGE_URL no está seteado, la función de media queda apagada y las
// rutas responden 503 en vez de romper.

const BRIDGE_TIMEOUT_MS = 30_000;
const ASSET_TIMEOUT_MS = 120_000;

function bridgeUrl(): string {
  // .trim(): un \r pegado al setear el secret desde un pipe rompe new URL().
  return (process.env.COMFY_BRIDGE_URL || "").trim().replace(/\/+$/, "");
}

function bridgeSecret(): string {
  return (process.env.COMFY_BRIDGE_SECRET || "").trim();
}

export function isBridgeConfigured(): boolean {
  return Boolean(bridgeUrl() && bridgeSecret());
}

export class BridgeError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 502, code = "bridge_error") {
    super(message);
    this.name = "BridgeError";
    this.status = status;
    this.code = code;
  }
}

async function call(
  path: string,
  init: RequestInit = {},
  timeoutMs = BRIDGE_TIMEOUT_MS,
): Promise<Response> {
  const base = bridgeUrl();
  if (!base) throw new BridgeError("Image generation is not configured", 503, "not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(base + path, {
      ...init,
      headers: {
        ...(init.headers || {}),
        "x-aether-bridge-secret": bridgeSecret(),
      },
      signal: controller.signal,
    });
  } catch {
    // Timeout, DNS, túnel caído: para el caller es siempre "la GPU no está".
    throw new BridgeError("The image engine is offline", 503, "engine_offline");
  } finally {
    clearTimeout(timer);
  }
}

async function callJson<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const res = await call(path, init, timeoutMs);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new BridgeError(`Malformed response from the image engine (${res.status})`);
  }

  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string } })?.error;
    // 400/404/429 son culpa del request: se propagan tal cual al cliente.
    const status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw new BridgeError(err?.message || `Image engine error (${res.status})`, status, err?.code || "bridge_error");
  }
  return body as T;
}

export interface BridgeAsset {
  index: number;
  content_type: string;
  size: number;
  url: string;
}

export interface BridgeJob {
  id: string;
  model: string;
  kind: "image" | "video";
  status: "queued" | "running" | "done" | "error";
  queue_position: number;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  seed: number | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  length: number | null;
  fps: number | null;
  assets: BridgeAsset[];
}

export interface BridgeCatalogEntry {
  id: string;
  kind: "image" | "video";
  label: string;
  defaults: Record<string, unknown>;
  limits: Record<string, unknown>;
  supports: Record<string, boolean>;
  available: boolean;
}

export interface BridgeHealth {
  ok: boolean;
  comfy_version: string | null;
  gpu: { name: string; vram_total: number; vram_free: number } | null;
  queue: { running: number; queued: number; concurrency: number; max_queue: number };
}

export async function submitBridgeJob(payload: Record<string, unknown>): Promise<BridgeJob> {
  return callJson<BridgeJob>("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    // Un init_image en base64 puede pesar; margen extra sobre el default.
  }, 60_000);
}

export async function getBridgeJob(id: string): Promise<BridgeJob | null> {
  try {
    return await callJson<BridgeJob>(`/jobs/${encodeURIComponent(id)}`);
  } catch (err) {
    // 404 = el bridge se reinició y perdió el job. El caller refunda.
    if (err instanceof BridgeError && err.status === 404) return null;
    throw err;
  }
}

export async function cancelBridgeJob(id: string): Promise<void> {
  await call(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
}

export async function fetchBridgeAsset(
  jobId: string,
  index: number,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await call(`/jobs/${encodeURIComponent(jobId)}/assets/${index}`, {}, ASSET_TIMEOUT_MS);
  if (!res.ok) throw new BridgeError(`Could not download the generated file (${res.status})`);
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

export interface BridgeCatalog {
  models: BridgeCatalogEntry[];
  loras: string[];
}

let catalogCache: { value: BridgeCatalog; expires: number } | null = null;

export async function getBridgeCatalog(): Promise<BridgeCatalog> {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.value;
  const body = await callJson<BridgeCatalog>("/catalog", {}, 60_000);
  const value = { models: body?.models ?? [], loras: body?.loras ?? [] };
  catalogCache = { value, expires: Date.now() + 60_000 };
  return value;
}

export async function getBridgeHealth(): Promise<BridgeHealth | null> {
  try {
    return await callJson<BridgeHealth>("/health", {}, 10_000);
  } catch {
    return null;
  }
}
