// Normalización de parámetros + construcción de grafos ComfyUI (formato API).
//
// Cada builder devuelve { graph, outputNodes }. El grafo usa ids string y la
// convención [nodeId, slot] para las conexiones, igual que "Save (API format)"
// del editor de ComfyUI.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

// Listas tomadas de /object_info de ComfyUI 0.4.0.
const SAMPLERS = new Set([
  "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp", "heun", "heunpp2",
  "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral",
  "dpmpp_2s_ancestral_cfg_pp", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_cfg_pp",
  "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_2m_sde_heun", "dpmpp_2m_sde_heun_gpu",
  "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ipndm", "ipndm_v", "deis",
  "res_multistep", "res_multistep_cfg_pp", "res_multistep_ancestral",
  "res_multistep_ancestral_cfg_pp", "gradient_estimation", "gradient_estimation_cfg_pp",
  "er_sde", "seeds_2", "seeds_3", "sa_solver", "sa_solver_pece", "ddim", "uni_pc", "uni_pc_bh2",
]);

const SCHEDULERS = new Set([
  "simple", "sgm_uniform", "karras", "exponential", "ddim_uniform", "beta", "normal",
  "linear_quadratic", "kl_optimal",
]);

const MAX_PROMPT_CHARS = 6000;
const MAX_LORAS = 4;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function intOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function floatOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundTo(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function randomSeed() {
  // ComfyUI acepta enteros grandes; se queda por debajo de 2^53 para que
  // sobreviva el round-trip por JSON sin perder precisión.
  return Math.floor(Math.random() * 2 ** 48);
}

/**
 * Valida y completa los parámetros de un job contra los límites de la entrada
 * del catálogo. Lanza ValidationError con un mensaje que el router puede
 * devolver tal cual al cliente.
 */
export function normalizeParams(entry, raw = {}) {
  const d = entry.defaults || {};
  const limits = entry.limits || {};
  const isVideo = entry.kind === "video";

  const prompt = String(raw.prompt ?? "").trim();
  if (!prompt) throw new ValidationError("El prompt es obligatorio");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new ValidationError(`El prompt excede ${MAX_PROMPT_CHARS} caracteres`);
  }

  let negative = String(raw.negative_prompt ?? d.negative_prompt ?? "").trim();
  if (negative.length > MAX_PROMPT_CHARS) {
    throw new ValidationError(`El prompt negativo excede ${MAX_PROMPT_CHARS} caracteres`);
  }
  if (!entry.supports?.negative) negative = "";

  // Wan pide múltiplos de 32; los modelos de imagen, de 8.
  const sizeStep = isVideo ? 32 : 8;
  let width = clamp(roundTo(intOr(raw.width, d.width), sizeStep), 256, 2048);
  let height = clamp(roundTo(intOr(raw.height, d.height), sizeStep), 256, 2048);

  const maxPixels = limits.maxPixels || 1024 * 1024;
  if (width * height > maxPixels) {
    // Se reescala manteniendo el aspect ratio en vez de rechazar: el usuario
    // pidió "más grande de lo que la GPU aguanta", no algo inválido.
    const factor = Math.sqrt(maxPixels / (width * height));
    width = clamp(roundTo(width * factor, sizeStep), 256, 2048);
    height = clamp(roundTo(height * factor, sizeStep), 256, 2048);
  }

  const steps = clamp(intOr(raw.steps, d.steps), 1, limits.maxSteps || 50);
  const cfg = clamp(floatOr(raw.cfg, d.cfg), 0, 20);
  const seed = raw.seed === undefined || raw.seed === null || raw.seed === -1
    ? randomSeed()
    : Math.abs(intOr(raw.seed, randomSeed()));
  const batch = clamp(intOr(raw.batch ?? raw.n, 1), 1, limits.maxBatch || 1);

  const sampler = SAMPLERS.has(String(raw.sampler)) ? String(raw.sampler) : d.sampler;
  const scheduler = SCHEDULERS.has(String(raw.scheduler)) ? String(raw.scheduler) : d.scheduler;

  const hasInit = Boolean(raw.init_image_name);
  const denoise = hasInit ? clamp(floatOr(raw.denoise, 0.6), 0.05, 1) : 1;

  const params = {
    prompt,
    negative_prompt: negative,
    width,
    height,
    steps,
    cfg,
    seed,
    batch,
    sampler,
    scheduler,
    denoise,
    init_image_name: hasInit ? String(raw.init_image_name) : null,
  };

  if (entry.engine === "flux") {
    params.guidance = clamp(floatOr(raw.guidance, d.guidance), 0, 20);
  }

  if (isVideo) {
    // Wan22ImageToVideoLatent usa step=4 sobre `length`; los workflows
    // oficiales usan 4k+1 (49, 81, 121) para que el primer frame sea el real.
    const rawLength = intOr(raw.length ?? raw.frames, d.length);
    const snapped = Math.round((rawLength - 1) / 4) * 4 + 1;
    params.length = clamp(snapped, 5, limits.maxLength || 81);
    params.fps = clamp(floatOr(raw.fps, d.fps), 1, 60);
    params.shift = clamp(floatOr(raw.shift, d.shift), 0, 100);
    params.batch = 1;
  }

  if (entry.supports?.loras) {
    const loras = Array.isArray(raw.loras) ? raw.loras.slice(0, MAX_LORAS) : [];
    params.loras = loras
      .map((l) => ({
        name: String(l?.name || "").trim(),
        strength: clamp(floatOr(l?.strength, 1), -4, 4),
      }))
      .filter((l) => l.name);
  } else {
    params.loras = [];
  }

  return params;
}

// Encadena LoraLoader sobre (model, clip) y devuelve las salidas finales.
function applyLoras(graph, nextId, loras, modelRef, clipRef) {
  let model = modelRef;
  let clip = clipRef;
  for (const lora of loras) {
    const id = String(nextId());
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength,
        strength_clip: lora.strength,
        model,
        clip,
      },
    };
    model = [id, 0];
    clip = [id, 1];
  }
  return { model, clip };
}

function makeIdFactory() {
  let n = 0;
  return () => String(++n);
}

function buildImageLatent(graph, id, entry, params, vaeRef) {
  if (params.init_image_name) {
    const loadId = id();
    graph[loadId] = { class_type: "LoadImage", inputs: { image: params.init_image_name } };
    const scaleId = id();
    graph[scaleId] = {
      class_type: "ImageScale",
      inputs: {
        image: [loadId, 0],
        upscale_method: "lanczos",
        width: params.width,
        height: params.height,
        crop: "center",
      },
    };
    const encId = id();
    graph[encId] = { class_type: "VAEEncode", inputs: { pixels: [scaleId, 0], vae: vaeRef } };
    return [encId, 0];
  }

  const latentId = id();
  graph[latentId] = {
    // Flux usa latentes de 16 canales: EmptySD3LatentImage es el correcto.
    class_type: entry.engine === "flux" ? "EmptySD3LatentImage" : "EmptyLatentImage",
    inputs: { width: params.width, height: params.height, batch_size: params.batch },
  };
  return [latentId, 0];
}

function buildFlux(entry, params) {
  const graph = {};
  const id = makeIdFactory();

  const ckptId = id();
  graph[ckptId] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: entry.checkpoint } };

  const { model, clip } = applyLoras(graph, id, params.loras, [ckptId, 0], [ckptId, 1]);

  const posId = id();
  graph[posId] = { class_type: "CLIPTextEncode", inputs: { text: params.prompt, clip } };
  const guidId = id();
  graph[guidId] = {
    class_type: "FluxGuidance",
    inputs: { conditioning: [posId, 0], guidance: params.guidance },
  };
  const negId = id();
  graph[negId] = { class_type: "CLIPTextEncode", inputs: { text: "", clip } };

  const latent = buildImageLatent(graph, id, entry, params, [ckptId, 2]);

  const ksId = id();
  graph[ksId] = {
    class_type: "KSampler",
    inputs: {
      model,
      positive: [guidId, 0],
      negative: [negId, 0],
      latent_image: latent,
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: params.sampler,
      scheduler: params.scheduler,
      denoise: params.denoise,
    },
  };

  const decId = id();
  graph[decId] = { class_type: "VAEDecode", inputs: { samples: [ksId, 0], vae: [ckptId, 2] } };
  const saveId = id();
  graph[saveId] = {
    class_type: "SaveImage",
    inputs: { images: [decId, 0], filename_prefix: "aether/flux" },
  };

  return { graph, outputNodes: [saveId] };
}

function buildSdxl(entry, params) {
  const graph = {};
  const id = makeIdFactory();

  const ckptId = id();
  graph[ckptId] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: entry.checkpoint } };

  const { model, clip } = applyLoras(graph, id, params.loras, [ckptId, 0], [ckptId, 1]);

  const posId = id();
  graph[posId] = { class_type: "CLIPTextEncode", inputs: { text: params.prompt, clip } };
  const negId = id();
  graph[negId] = { class_type: "CLIPTextEncode", inputs: { text: params.negative_prompt, clip } };

  const latent = buildImageLatent(graph, id, entry, params, [ckptId, 2]);

  const ksId = id();
  graph[ksId] = {
    class_type: "KSampler",
    inputs: {
      model,
      positive: [posId, 0],
      negative: [negId, 0],
      latent_image: latent,
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: params.sampler,
      scheduler: params.scheduler,
      denoise: params.denoise,
    },
  };

  const decId = id();
  graph[decId] = { class_type: "VAEDecode", inputs: { samples: [ksId, 0], vae: [ckptId, 2] } };
  const saveId = id();
  graph[saveId] = {
    class_type: "SaveImage",
    inputs: { images: [decId, 0], filename_prefix: "aether/sdxl" },
  };

  return { graph, outputNodes: [saveId] };
}

function buildWan225b(entry, params) {
  const graph = {};
  const id = makeIdFactory();

  const unetId = id();
  graph[unetId] = {
    class_type: "UNETLoader",
    inputs: { unet_name: entry.unet, weight_dtype: "default" },
  };
  const clipId = id();
  graph[clipId] = { class_type: "CLIPLoader", inputs: { clip_name: entry.clip, type: "wan" } };
  const vaeId = id();
  graph[vaeId] = { class_type: "VAELoader", inputs: { vae_name: entry.vae } };

  const posId = id();
  graph[posId] = { class_type: "CLIPTextEncode", inputs: { text: params.prompt, clip: [clipId, 0] } };
  const negId = id();
  graph[negId] = {
    class_type: "CLIPTextEncode",
    inputs: { text: params.negative_prompt, clip: [clipId, 0] },
  };

  const shiftId = id();
  graph[shiftId] = {
    class_type: "ModelSamplingSD3",
    inputs: { model: [unetId, 0], shift: params.shift },
  };

  const latentInputs = {
    vae: [vaeId, 0],
    width: params.width,
    height: params.height,
    length: params.length,
    batch_size: 1,
  };
  if (params.init_image_name) {
    const loadId = id();
    graph[loadId] = { class_type: "LoadImage", inputs: { image: params.init_image_name } };
    const scaleId = id();
    graph[scaleId] = {
      class_type: "ImageScale",
      inputs: {
        image: [loadId, 0],
        upscale_method: "lanczos",
        width: params.width,
        height: params.height,
        crop: "center",
      },
    };
    latentInputs.start_image = [scaleId, 0];
  }
  const latId = id();
  graph[latId] = { class_type: "Wan22ImageToVideoLatent", inputs: latentInputs };

  const ksId = id();
  graph[ksId] = {
    class_type: "KSampler",
    inputs: {
      model: [shiftId, 0],
      positive: [posId, 0],
      negative: [negId, 0],
      latent_image: [latId, 0],
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: params.sampler,
      scheduler: params.scheduler,
      denoise: 1,
    },
  };

  const decId = id();
  graph[decId] = { class_type: "VAEDecode", inputs: { samples: [ksId, 0], vae: [vaeId, 0] } };
  const vidId = id();
  graph[vidId] = { class_type: "CreateVideo", inputs: { images: [decId, 0], fps: params.fps } };
  const saveId = id();
  graph[saveId] = {
    class_type: "SaveVideo",
    inputs: {
      video: [vidId, 0],
      filename_prefix: "aether/wan",
      format: "auto",
      codec: "auto",
    },
  };

  return { graph, outputNodes: [saveId] };
}

const BUILDERS = {
  flux: buildFlux,
  sdxl: buildSdxl,
  "wan22-5b": buildWan225b,
};

export function buildGraph(entry, params) {
  const builder = BUILDERS[entry.engine];
  if (!builder) throw new ValidationError(`Motor desconocido: ${entry.engine}`);
  return builder(entry, params);
}
