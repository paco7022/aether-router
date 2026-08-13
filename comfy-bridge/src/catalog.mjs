// Catálogo de modelos que el bridge sabe ejecutar.
//
// Es DINÁMICO: se arma leyendo los checkpoints que ComfyUI tiene cargados, así
// que dejar un .safetensors nuevo en models/checkpoints lo publica solo (previo
// `INSERT` en la tabla `models` del router — ver scripts/generate-models-sql.mjs).
//
// Sobre eso van dos capas a mano:
//   - CURATED: modelos que no son un checkpoint SDXL/Flux normal (video Wan,
//     que carga unet + clip + vae por separado).
//   - OVERRIDES: ajustes por archivo cuando los defaults automáticos no sirven
//     (modelos Lightning/Turbo, que se arruinan a 28 steps y cfg 5).
//
// El `id` es lo que el router guarda en `models.upstream_model_id`.

import { loadedFiles } from "./comfy.mjs";

// Archivos que NO se publican: arquitecturas que los builders actuales no
// saben armar. Sacar de acá cuando exista el workflow correspondiente.
const EXCLUDED = [
  // Z-Image (Tongyi) no corre con el grafo SDXL/Flux estándar.
  /zimage/i,
  // El flux1-dev completo (22GB) duplica a flux1-dev-fp8 con peor latencia.
  /^flux1-dev\.safetensors$/i,
];

const ANIME_NEGATIVE =
  "worst quality, low quality, lowres, jpeg artifacts, bad anatomy, bad hands, watermark, signature";
const PHOTO_NEGATIVE = "worst quality, low quality, blurry, deformed, watermark, text";

// Pocos steps y cfg bajo: los modelos destilados se queman con los defaults.
const FAST_PRESET = {
  steps: 6,
  cfg: 1.5,
  sampler: "dpmpp_sde",
  scheduler: "karras",
  maxSteps: 14,
};

const ANIME_PRESET = {
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5,
  sampler: "euler_ancestral",
  scheduler: "normal",
  negative_prompt: ANIME_NEGATIVE,
};

const PHOTO_PRESET = {
  width: 1024,
  height: 1024,
  steps: 30,
  cfg: 4.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  negative_prompt: PHOTO_NEGATIVE,
};

const FAST_RE = /lightning|turbo|hyper|lcm|dmd|_4step|8step/i;
const ANIME_RE =
  /illustrious|noobai|anime|animij|animayhem|anicore|ntrmix|wai|hassaku|janku|prefect|nova|obsession|unholy|iris|vidroh/i;

// Nombres bonitos para los checkpoints más usados. El resto se prettifica solo.
const DISPLAY_OVERRIDES = {
  "SDXL\\waiIllustriousSDXL_v150.safetensors": "WAI Illustrious v15 (anime)",
  "SDXL\\waiIllustriousSDXL_v130-015.safetensors": "WAI Illustrious v13 (anime)",
  "SDXL\\hassakuXLIllustrious_v22-013.safetensors": "Hassaku XL v2.2 (anime)",
  "SDXL\\hassakuXLIllustrious_v13StyleA-011.safetensors": "Hassaku XL v1.3 Style A (anime)",
  "SDXL\\prefectIllustriousXL_v70.safetensors": "Prefect Illustrious v7 (anime)",
  "SDXL\\juggernautXL_ragnarokBy.safetensors": "Juggernaut XL Ragnarok (realismo)",
  "SDXL\\realvisxlV50_v50LightningBakedvae.safetensors": "RealVis XL v5 Lightning (rápido)",
  "SDXL\\illustriousXL_v01.safetensors": "Illustrious XL v0.1 (base anime)",
  "SDXL\\sd_xl_base_1.0-009.safetensors": "SDXL Base 1.0",
  "SDXL\\nova3DCGXL_ilV90.safetensors": "Nova 3DCG XL v9 (3D)",
  "SDXL\\novaOrangeXL_reV30-010.safetensors": "Nova Orange XL v3",
  "SDXL\\illustriousRealismBy_v10VAE-014.safetensors": "Illustrious Realism v1",
  "flux1-dev-fp8.safetensors": "FLUX.1 dev",
};

// Ajustes por archivo que ganan sobre los presets automáticos.
const OVERRIDES = {
  "flux1-dev-fp8.safetensors": {
    id: "flux-dev",
    engine: "flux",
    defaults: {
      width: 1024,
      height: 1024,
      steps: 20,
      cfg: 1,
      guidance: 3.5,
      sampler: "euler",
      scheduler: "simple",
      denoise: 1,
    },
    limits: { maxSteps: 50, maxPixels: 1536 * 1536, maxBatch: 4 },
    // Flux corre a cfg=1: el prompt negativo no se aplica.
    supports: { negative: false, img2img: true, loras: true },
  },
};

// Modelos que no salen de la lista de checkpoints.
const CURATED = [
  {
    id: "wan-2.2-5b",
    kind: "video",
    engine: "wan22-5b",
    label: "Wan 2.2 TI2V 5B (video)",
    unet: "Wan2_2-TI2V-5B_fp8_e4m3fn_scaled_KJ.safetensors",
    clip: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    vae: "wan2.2_vae.safetensors",
    defaults: {
      width: 1280,
      height: 704,
      length: 49,
      fps: 24,
      steps: 30,
      cfg: 5,
      shift: 8,
      sampler: "uni_pc",
      scheduler: "simple",
      denoise: 1,
      negative_prompt:
        "低质量, 模糊, 静止不动, 变形, 多余的手指, 画面暗淡, overexposed, static, blurry, low quality",
    },
    // 121 frames @ 24fps = 5s. Más satura VRAM y tarda demasiado.
    limits: { maxSteps: 40, maxPixels: 1280 * 704, maxLength: 121, maxBatch: 1 },
    supports: { negative: true, i2v: true, loras: false },
  },
];

function baseName(file) {
  return String(file).split(/[\\/]/).pop().replace(/\.safetensors$|\.ckpt$|\.gguf$/i, "");
}

export function slugFor(file) {
  const name = baseName(file)
    // camelCase -> palabras, para que el slug no quede pegado.
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    // Sufijo de numeración del downloader (-016, -002...) no aporta nada.
    .replace(/-\d{3}$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "model";
}

function prettify(file) {
  return baseName(file)
    .replace(/-\d{3}$/, "")
    .replace(/[_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function autoEntry(file) {
  const fast = FAST_RE.test(file);
  const anime = ANIME_RE.test(file);
  const preset = anime ? ANIME_PRESET : PHOTO_PRESET;

  const defaults = {
    ...preset,
    denoise: 1,
    ...(fast
      ? { steps: FAST_PRESET.steps, cfg: FAST_PRESET.cfg, sampler: FAST_PRESET.sampler, scheduler: FAST_PRESET.scheduler }
      : {}),
  };

  return {
    id: slugFor(file),
    kind: "image",
    engine: "sdxl",
    label: DISPLAY_OVERRIDES[file] || prettify(file),
    checkpoint: file,
    defaults,
    limits: {
      maxSteps: fast ? FAST_PRESET.maxSteps : 60,
      maxPixels: 1536 * 1536,
      maxBatch: 4,
    },
    supports: { negative: true, img2img: true, loras: true },
  };
}

function buildEntries(files) {
  const entries = [...CURATED];
  const seen = new Set(entries.map((e) => e.id));

  for (const file of files.checkpoints || []) {
    if (EXCLUDED.some((re) => re.test(baseName(file)) || re.test(file))) continue;

    const override = OVERRIDES[file];
    const entry = override
      ? {
          kind: "image",
          engine: "sdxl",
          label: DISPLAY_OVERRIDES[file] || prettify(file),
          checkpoint: file,
          ...override,
          id: override.id || slugFor(file),
        }
      : autoEntry(file);

    // Dos archivos distintos pueden colapsar al mismo slug; gana el primero.
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }

  return entries;
}

let cache = { entries: null, loras: [], expires: 0 };

async function refresh() {
  const files = await loadedFiles();
  cache = {
    entries: buildEntries(files),
    loras: [...(files.loras || [])].sort((a, b) => a.localeCompare(b)),
    files,
    expires: Date.now() + 60_000,
  };
  return cache;
}

export async function getCatalog() {
  if (cache.entries && cache.expires > Date.now()) return cache;
  return refresh();
}

export async function getEntry(id) {
  const { entries } = await getCatalog();
  return entries.find((e) => e.id === String(id || "")) || null;
}

// Archivos que la entrada necesita, agrupados por carpeta de ComfyUI.
export function requiredFiles(entry) {
  const files = [];
  if (entry.checkpoint) files.push({ folder: "checkpoints", name: entry.checkpoint });
  if (entry.unet) files.push({ folder: "diffusion_models", name: entry.unet });
  if (entry.clip) files.push({ folder: "text_encoders", name: entry.clip });
  if (entry.vae) files.push({ folder: "vae", name: entry.vae });
  return files;
}

// Vista pública (sin nombres de archivo internos).
export function publicEntry(entry, available) {
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    defaults: entry.defaults,
    limits: entry.limits,
    supports: entry.supports,
    available,
  };
}
