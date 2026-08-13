"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ── Tipos que devuelve /api/v1/media/* ───────────────────── */

interface MediaModel {
  id: string;
  modality: "image" | "video";
  display_name: string;
  available: boolean;
  defaults: Record<string, number | string>;
  limits: Record<string, number>;
  supports: Record<string, boolean>;
  pricing: {
    base_credits: number;
    base_pixels: number | null;
    base_steps: number | null;
    base_frames: number | null;
    default_credits: number;
  };
}

interface JobAsset {
  url: string | null;
  content_type: string;
  size: number;
}

interface Job {
  id: string;
  model: string;
  kind: "image" | "video";
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  prompt: string;
  seed: number | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  frames: number | null;
  credits: number;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  assets: JobAsset[];
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "AetherRouter",
};

const IMAGE_RATIOS = [
  { label: "1:1", width: 1024, height: 1024 },
  { label: "3:4", width: 896, height: 1152 },
  { label: "4:3", width: 1152, height: 896 },
  { label: "9:16", width: 832, height: 1216 },
  { label: "16:9", width: 1216, height: 832 },
];

const VIDEO_RATIOS = [
  { label: "16:9", width: 1280, height: 704 },
  { label: "9:16", width: 704, height: 1280 },
  { label: "4:3", width: 832, height: 640 },
];

const MAX_INIT_IMAGE_BYTES = 8 * 1024 * 1024;

/* Mismo cálculo que src/lib/media-credits.ts, para mostrar el precio antes de
   apretar el botón. El servidor sigue siendo quien cobra. */
function estimateCredits(model: MediaModel, spec: {
  width: number;
  height: number;
  steps: number;
  batch: number;
  frames: number | null;
}): number {
  const base = model.pricing.base_credits;
  if (!base) return 0;
  const ratio = (actual: number, reference: number | null) =>
    reference && reference > 0 && actual > 0 ? actual / reference : 1;

  let units =
    ratio(spec.width * spec.height, model.pricing.base_pixels) *
    ratio(spec.steps, model.pricing.base_steps);
  if (spec.frames != null) units *= ratio(spec.frames, model.pricing.base_frames);
  units *= Math.max(1, spec.batch);

  return Math.max(1, Math.ceil(base * units));
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const MAX_LORAS = 4;

export default function ImagesStudio() {
  const [models, setModels] = useState<MediaModel[]>([]);
  const [loras, setLoras] = useState<string[]>([]);
  const [loraQuery, setLoraQuery] = useState("");
  const [selectedLoras, setSelectedLoras] = useState<{ name: string; strength: number }[]>([]);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  const [modelId, setModelId] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(20);
  const [batch, setBatch] = useState(1);
  const [seed, setSeed] = useState<string>("");
  const [length, setLength] = useState(49);
  const [fps, setFps] = useState(24);
  const [denoise, setDenoise] = useState(0.6);
  const [initImage, setInitImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const model = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId]);
  const isVideo = model?.modality === "video";

  /* ── Carga inicial ──────────────────────────────────────── */

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/v1/media/jobs?limit=40");
    if (!res.ok) return;
    const body = await res.json();
    setJobs((body.data as Job[]) || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/media/models");
        const body = await res.json();
        const list = (body.data as MediaModel[]) || [];
        setModels(list);
        setLoras((body.loras as string[]) || []);
        setEngineOnline(Boolean(body.engine?.online));
        setQueueDepth(body.engine?.queued ?? null);
        if (list.length > 0) setModelId(list.find((m) => m.available)?.id ?? list[0].id);
        await loadJobs();
      } catch {
        setError("No se pudo cargar el catálogo de generación.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadJobs]);

  // Al cambiar de modelo, los controles arrancan en los defaults de ese modelo.
  useEffect(() => {
    if (!model) return;
    const d = model.defaults;
    setWidth(num(d.width, 1024));
    setHeight(num(d.height, 1024));
    setSteps(num(d.steps, 20));
    setBatch(1);
    if (model.modality === "video") {
      setLength(num(d.length, 49));
      setFps(num(d.fps, 24));
    }
    if (!model.supports.negative) setNegative("");
    if (!model.supports.loras) setSelectedLoras([]);
    setInitImage(null);
  }, [model]);

  /* ── Poll mientras haya trabajo en curso ────────────────── */

  const hasOpenJobs = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (!hasOpenJobs) return;
    const timer = setInterval(loadJobs, 2500);
    return () => clearInterval(timer);
  }, [hasOpenJobs, loadJobs]);

  /* ── Acciones ───────────────────────────────────────────── */

  const estimate = model
    ? estimateCredits(model, {
        width,
        height,
        steps,
        batch: isVideo ? 1 : batch,
        frames: isVideo ? length : null,
      })
    : 0;

  async function handleFile(file: File | null) {
    if (!file) return setInitImage(null);
    if (file.size > MAX_INIT_IMAGE_BYTES) {
      setError("La imagen de referencia supera 8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setInitImage({ dataUrl: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (!model || submitting) return;
    if (!prompt.trim()) {
      setError("Escribí un prompt.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      model: model.id,
      prompt: prompt.trim(),
      width,
      height,
      steps,
    };
    if (negative.trim()) payload.negative_prompt = negative.trim();
    if (seed.trim()) payload.seed = Number(seed.trim());
    if (isVideo) {
      payload.length = length;
      payload.fps = fps;
    } else {
      payload.batch = batch;
    }
    if (initImage) {
      payload.init_image = initImage.dataUrl;
      if (!isVideo) payload.denoise = denoise;
    }
    if (model.supports.loras && selectedLoras.length > 0) payload.loras = selectedLoras;

    try {
      const res = await fetch("/api/v1/media/jobs", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message || "No se pudo encolar la generación.");
        return;
      }
      setJobs((prev) => [body as Job, ...prev]);
    } catch {
      setError("Error de red al encolar la generación.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(jobId: string) {
    await fetch(`/api/v1/media/jobs/${jobId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    }).catch(() => null);
    await loadJobs();
  }

  /* ── Render ─────────────────────────────────────────────── */

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)]">Cargando estudio…</p>;
  }

  if (models.length === 0) {
    return (
      <div className="glass-card aurora-border p-6">
        <p className="text-sm text-[var(--text-muted)]">
          No hay modelos de generación activos en este momento.
        </p>
      </div>
    );
  }

  const ratios = isVideo ? VIDEO_RATIOS : IMAGE_RATIOS;
  const maxSteps = num(model?.limits.maxSteps, 50);
  const maxBatch = num(model?.limits.maxBatch, 1);
  const maxLength = num(model?.limits.maxLength, 81);
  const supportsInit = Boolean(model?.supports.img2img || model?.supports.i2v);

  return (
    <div className="space-y-6">
      {engineOnline === false && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{
            background: "rgba(239, 68, 68, 0.06)",
            border: "1px solid rgba(239, 68, 68, 0.15)",
            color: "rgba(252, 165, 165, 0.95)",
          }}
        >
          El motor de generación (GPU) está desconectado ahora mismo. Podés escribir el prompt,
          pero la generación va a fallar hasta que vuelva.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-6">
        {/* ── Panel de controles ── */}
        <div className="glass-card aurora-border shimmer-line p-5 space-y-4 h-fit">
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
              Modelo
            </label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="mt-2 w-full rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-sm text-white/90 focus:outline-none focus:border-violet-400/30"
            >
              <optgroup label="Imagen">
                {models
                  .filter((m) => m.modality === "image")
                  .map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.available}>
                      {m.display_name}
                      {m.available ? "" : " (no disponible)"}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Video">
                {models
                  .filter((m) => m.modality === "video")
                  .map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.available}>
                      {m.display_name}
                      {m.available ? "" : " (no disponible)"}
                    </option>
                  ))}
              </optgroup>
            </select>
            <p className="text-[10px] text-[var(--text-dim)] mt-1 font-mono">{modelId}</p>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="a fox running through a snowy forest, cinematic lighting"
              className="mt-2 w-full rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-sm text-white/90 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-violet-400/30 resize-y"
            />
          </div>

          {model?.supports.negative && (
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                Prompt negativo
              </label>
              <textarea
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                rows={2}
                placeholder="worst quality, blurry, watermark"
                className="mt-2 w-full rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-sm text-white/90 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-violet-400/30 resize-y"
              />
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
              Formato
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {ratios.map((r) => (
                <button
                  key={r.label}
                  onClick={() => {
                    setWidth(r.width);
                    setHeight(r.height);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                    width === r.width && height === r.height
                      ? "text-cyan-200 border-cyan-400/30 bg-cyan-400/[0.06]"
                      : "text-[var(--text-muted)] border-white/[0.05] hover:bg-white/[0.03]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-dim)] mt-1.5 font-mono">
              {width} × {height}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                Steps
              </label>
              <span className="text-xs font-mono text-white/70">{steps}</span>
            </div>
            <input
              type="range"
              min={1}
              max={maxSteps}
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="mt-2 w-full accent-violet-400"
            />
          </div>

          {isVideo ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                    Frames
                  </label>
                  <span className="text-xs font-mono text-white/70">{length}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={maxLength}
                  step={4}
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                  className="mt-2 w-full accent-violet-400"
                />
                <p className="text-[10px] text-[var(--text-dim)] mt-1">
                  ≈ {(length / fps).toFixed(1)}s
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                    FPS
                  </label>
                  <span className="text-xs font-mono text-white/70">{fps}</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={30}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="mt-2 w-full accent-violet-400"
                />
              </div>
            </div>
          ) : (
            maxBatch > 1 && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                    Imágenes
                  </label>
                  <span className="text-xs font-mono text-white/70">{batch}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={maxBatch}
                  value={batch}
                  onChange={(e) => setBatch(Number(e.target.value))}
                  className="mt-2 w-full accent-violet-400"
                />
              </div>
            )
          )}

          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
              Seed
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="aleatoria"
                className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-sm font-mono text-white/90 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-violet-400/30"
              />
              <button
                onClick={() => setSeed("")}
                className="px-3 rounded-xl text-xs text-[var(--text-muted)] border border-white/[0.06] hover:bg-white/[0.03]"
              >
                Limpiar
              </button>
            </div>
          </div>

          {model?.supports.loras && loras.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                  LoRAs
                </label>
                <span className="text-[10px] text-[var(--text-dim)]">
                  {selectedLoras.length}/{MAX_LORAS} · {loras.length} disponibles
                </span>
              </div>

              {selectedLoras.length > 0 && (
                <div className="mt-2 space-y-2">
                  {selectedLoras.map((lora, i) => (
                    <div key={lora.name} className="rounded-lg border border-white/[0.06] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-[11px] text-white/80 truncate font-mono"
                          title={lora.name}
                        >
                          {lora.name.replace(/\.safetensors$/i, "")}
                        </span>
                        <button
                          onClick={() =>
                            setSelectedLoras((prev) => prev.filter((l) => l.name !== lora.name))
                          }
                          className="text-[10px] text-[var(--text-dim)] hover:text-red-300 shrink-0"
                        >
                          Quitar
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          type="range"
                          min={-1}
                          max={2}
                          step={0.05}
                          value={lora.strength}
                          onChange={(e) =>
                            setSelectedLoras((prev) =>
                              prev.map((l, j) =>
                                j === i ? { ...l, strength: Number(e.target.value) } : l,
                              ),
                            )
                          }
                          className="flex-1 accent-violet-400"
                        />
                        <span className="text-[11px] font-mono text-white/70 w-10 text-right">
                          {lora.strength.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedLoras.length < MAX_LORAS && (
                <>
                  <input
                    value={loraQuery}
                    onChange={(e) => setLoraQuery(e.target.value)}
                    placeholder="Buscar LoRA…"
                    className="mt-2 w-full rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-xs text-white/90 placeholder:text-[var(--text-dim)] focus:outline-none focus:border-violet-400/30"
                  />
                  {loraQuery.trim() && (
                    <div className="mt-1.5 max-h-44 overflow-y-auto rounded-xl border border-white/[0.06] divide-y divide-white/[0.04]">
                      {loras
                        .filter(
                          (name) =>
                            name.toLowerCase().includes(loraQuery.trim().toLowerCase()) &&
                            !selectedLoras.some((l) => l.name === name),
                        )
                        .slice(0, 40)
                        .map((name) => (
                          <button
                            key={name}
                            onClick={() => {
                              setSelectedLoras((prev) => [...prev, { name, strength: 1 }]);
                              setLoraQuery("");
                            }}
                            className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-white hover:bg-white/[0.03] truncate"
                            title={name}
                          >
                            {name.replace(/\.safetensors$/i, "")}
                          </button>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {supportsInit && (
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                {isVideo ? "Imagen inicial (image-to-video)" : "Imagen de referencia (img2img)"}
              </label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-[var(--text-muted)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:bg-white/[0.05] file:text-white/80"
                />
                {initImage && (
                  <button
                    onClick={() => {
                      setInitImage(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="text-xs text-[var(--text-dim)] hover:text-red-300"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {initImage && !isVideo && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-dim)]">
                      Fuerza del cambio
                    </label>
                    <span className="text-xs font-mono text-white/70">{denoise.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={denoise}
                    onChange={(e) => setDenoise(Number(e.target.value))}
                    className="mt-2 w-full accent-violet-400"
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-300/90 bg-red-500/[0.06] border border-red-500/15 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="pt-1 flex items-center justify-between gap-3">
            <div className="text-xs">
              <span className="text-[var(--text-dim)]">Costo estimado</span>
              <p className="text-base font-bold aurora-text leading-tight">
                {estimate.toLocaleString()} créditos
              </p>
              <p className="text-[10px] text-[var(--text-dim)]">
                ${(estimate / 10000).toFixed(4)}
                {queueDepth != null && queueDepth > 0 && ` · ${queueDepth} en cola`}
              </p>
            </div>
            <button
              onClick={generate}
              disabled={submitting || !model?.available}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-40 transition-all"
              style={{
                background:
                  "linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(34, 211, 238, 0.2))",
                border: "1px solid rgba(139, 92, 246, 0.3)",
              }}
            >
              {submitting ? "Encolando…" : "Generar"}
            </button>
          </div>
        </div>

        {/* ── Galería ── */}
        <div className="space-y-4">
          {jobs.length === 0 && (
            <div className="glass-card aurora-border p-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">
                Todavía no generaste nada. Escribí un prompt y dale a Generar.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} onCancel={cancel} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobCard({ job, onCancel }: { job: Job; onCancel: (id: string) => void }) {
  const open = job.status === "queued" || job.status === "running";
  const failed = job.status === "failed" || job.status === "canceled";

  return (
    <div className="glass-card aurora-border overflow-hidden flex flex-col">
      <div
        className="relative w-full flex items-center justify-center bg-black/30"
        style={{ aspectRatio: `${job.width || 1} / ${job.height || 1}`, minHeight: 140 }}
      >
        {open && (
          <div className="flex flex-col items-center gap-2 py-8">
            <span className="live-dot" />
            <p className="text-xs text-[var(--text-muted)]">
              {job.status === "queued" ? "En cola…" : "Generando…"}
            </p>
          </div>
        )}

        {failed && (
          <p className="text-xs text-red-300/80 px-4 py-8 text-center">
            {job.error || "Falló la generación"}
          </p>
        )}

        {job.status === "succeeded" &&
          job.assets.map((asset, i) =>
            asset.url ? (
              asset.content_type.startsWith("video/") ? (
                <video
                  key={i}
                  src={asset.url}
                  controls
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <a key={i} href={asset.url} target="_blank" rel="noreferrer" className="w-full h-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={job.prompt.slice(0, 80)}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </a>
              )
            ) : null,
          )}
      </div>

      <div className="p-3 space-y-2">
        <p className="text-xs text-white/70 line-clamp-2" title={job.prompt}>
          {job.prompt}
        </p>
        <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)] font-mono">
          <span>{job.model}</span>
          <span>
            {job.status === "succeeded"
              ? `${job.credits.toLocaleString()} cr`
              : job.status}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)]">
          <span className="font-mono">
            {job.width}×{job.height}
            {job.frames ? ` · ${job.frames}f` : ""}
            {job.seed != null ? ` · seed ${job.seed}` : ""}
          </span>
          {open && (
            <button onClick={() => onCancel(job.id)} className="text-[10px] hover:text-red-300">
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
