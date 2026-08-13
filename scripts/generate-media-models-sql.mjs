// Genera la migración SQL de modelos de media a partir del catálogo VIVO del
// comfy-bridge, para que la tabla `models` y la GPU no se desincronicen.
//
// Desde la raíz del repo (aether-router/):
//   node scripts/generate-media-models-sql.mjs > supabase/migrations/XXXX_media_models.sql
//
// El secreto y la URL del bridge salen de .env.local; se pueden pisar con
// BRIDGE_SECRET / BRIDGE_URL.
//
// Cuando dejes un checkpoint nuevo en ComfyUI/models/checkpoints: reiniciá el
// bridge (o esperá 60s de cache), corré esto y aplicá el .sql generado en el
// SQL Editor de Supabase. Este archivo es JavaScript: NO se pega en el editor.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// El secreto ya vive en .env.local: leerlo de ahí evita tener que exportarlo a
// mano cada vez (y que termine pegado en un historial de shell).
function fromEnvLocal(key) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const line = readFileSync(path.join(root, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : "";
  } catch {
    return "";
  }
}

const base = (
  process.env.BRIDGE_URL ||
  fromEnvLocal("COMFY_BRIDGE_URL") ||
  "http://127.0.0.1:8189"
)
  .trim()
  .replace(/\/+$/, "");

const secret =
  process.env.BRIDGE_SECRET ||
  process.env.COMFY_BRIDGE_SECRET ||
  fromEnvLocal("COMFY_BRIDGE_SECRET");

// Créditos por generación en la configuración de referencia (1MP, steps por
// defecto del modelo). Ver src/lib/media-credits.ts para el escalado.
const IMAGE_CREDITS = 500;
const VIDEO_CREDITS = 3000;
const REFERENCE_PIXELS = 1024 * 1024;

// Modelos ya publicados con un id "lindo": se respeta ese id y solo se
// re-apunta el upstream. Sin esto, cambiar el slug rompería a quien ya usa
// img/anime-xl en su código.
const ALIASES = {
  "wai-illustrious-sdxl-v150": "img/anime-xl",
  "juggernaut-xl-ragnarok-by": "img/realism-xl",
  "realvisxl-v50-v50-lightning-bakedvae": "img/realism-xl-fast",
  "flux-dev": "img/flux-dev",
  "wan-2.2-5b": "vid/wan-2.2-5b",
};

function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const res = await fetch(`${base}/catalog`, {
  headers: { "x-aether-bridge-secret": secret },
});
if (!res.ok) {
  console.error(`El bridge respondió ${res.status}. ¿BRIDGE_SECRET correcto?`);
  process.exit(1);
}
const { models } = await res.json();
const usable = models.filter((m) => m.available);

const rows = usable.map((m) => {
  const isVideo = m.kind === "video";
  const id = ALIASES[m.id] || `${isVideo ? "vid" : "img"}/${m.id}`;
  const d = m.defaults || {};
  return {
    id,
    upstream: m.id,
    label: m.label,
    modality: m.kind,
    credits: isVideo ? VIDEO_CREDITS : IMAGE_CREDITS,
    pixels: isVideo ? Number(d.width) * Number(d.height) : REFERENCE_PIXELS,
    steps: Number(d.steps) || 20,
    frames: isVideo ? Number(d.length) || null : null,
    config: JSON.stringify({ defaults: d, limits: m.limits || {}, supports: m.supports || {} }),
  };
});

const stamp = new Date().toISOString().slice(0, 10);

console.log(`-- ============================================================
-- Catálogo de modelos de imagen/video (provider comfy)
--
-- GENERADO por scripts/generate-media-models-sql.mjs desde el catálogo vivo
-- del comfy-bridge el ${stamp}. No editar a mano: volvé a generarlo.
--
-- Precio: ${IMAGE_CREDITS} créditos por imagen y ${VIDEO_CREDITS} por clip en la configuración
-- de referencia (1MP y los steps por defecto de cada modelo); escala con
-- píxeles/steps/frames en src/lib/media-credits.ts.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output, margin,
  is_active, context_length, capabilities,
  modality, media_base_credits, media_base_pixels, media_base_steps, media_base_frames, media_config
) VALUES`);

console.log(
  rows
    .map(
      (r) =>
        `  (${q(r.id)}, 'comfy', ${q(r.upstream)}, ${q(r.label)}, 0, 0, 1.0, true, NULL,` +
        ` '["${r.modality}_generation"]'::jsonb, ${q(r.modality)}, ${r.credits}, ${r.pixels}, ${r.steps},` +
        ` ${r.frames ?? "NULL"}, ${q(r.config)}::jsonb)`,
    )
    .join(",\n"),
);

console.log(`ON CONFLICT (id) DO UPDATE
SET provider           = EXCLUDED.provider,
    upstream_model_id  = EXCLUDED.upstream_model_id,
    display_name       = EXCLUDED.display_name,
    capabilities       = EXCLUDED.capabilities,
    modality           = EXCLUDED.modality,
    media_base_credits = EXCLUDED.media_base_credits,
    media_base_pixels  = EXCLUDED.media_base_pixels,
    media_base_steps   = EXCLUDED.media_base_steps,
    media_base_frames  = EXCLUDED.media_base_frames,
    media_config       = EXCLUDED.media_config;

-- Un checkpoint borrado de la PC no debe quedar ofertado en el catálogo.
UPDATE models
SET is_active = false
WHERE provider = 'comfy'
  AND upstream_model_id NOT IN (${rows.map((r) => q(r.upstream)).join(", ")});`);
