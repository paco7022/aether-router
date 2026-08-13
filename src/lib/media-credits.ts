// Precio en créditos de una generación de imagen/video.
//
// A diferencia del chat no hay tokens: el costo real para nosotros es tiempo de
// GPU, que escala básicamente con píxeles × steps (y × frames en video). El
// precio de la tabla `models` es "créditos por unidad base" y acá se escala.
//
// Los números salen de columnas de la DB (media_base_*), nunca hardcodeados:
// cambiar precios es un UPDATE, no un deploy.

export interface MediaPricing {
  media_base_credits: number;
  media_base_pixels?: number | null;
  media_base_steps?: number | null;
  media_base_frames?: number | null;
}

export interface MediaSpec {
  width: number;
  height: number;
  steps: number;
  /** Imágenes por request. Video siempre 1. */
  batch?: number;
  /** Frames del clip; solo video. */
  frames?: number | null;
}

// Un factor solo escala cuando la referencia existe y es > 0. Si falta la
// columna (modelo mal cargado) el factor es 1: se cobra el precio base en vez
// de dividir por cero o regalar la generación.
function ratio(actual: number, base: number | null | undefined): number {
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return 1;
  const a = Number(actual);
  if (!Number.isFinite(a) || a <= 0) return 1;
  return a / b;
}

export function mediaCredits(pricing: MediaPricing, spec: MediaSpec): number {
  const base = Number(pricing.media_base_credits);
  if (!Number.isFinite(base) || base <= 0) return 0;

  const pixels = Math.max(1, Number(spec.width) * Number(spec.height));
  const batch = Math.max(1, Math.floor(Number(spec.batch) || 1));

  let units =
    ratio(pixels, pricing.media_base_pixels) * ratio(spec.steps, pricing.media_base_steps);

  if (spec.frames != null) {
    units *= ratio(spec.frames, pricing.media_base_frames);
  }

  units *= batch;

  // Nunca cobrar 0 por algo que ya ocupó la GPU.
  return Math.max(1, Math.ceil(base * units));
}
