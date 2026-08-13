import { NextResponse } from "next/server";
import { getBridgeCatalog, getBridgeHealth, isBridgeConfigured } from "@/lib/comfy-bridge";
import { listMediaModels } from "@/lib/media-jobs";
import { mediaCredits } from "@/lib/media-credits";

export const runtime = "nodejs";

// Catálogo público de modelos de imagen/video, con el precio de referencia ya
// calculado para que la UI (y quien lea los docs) no tenga que replicar la
// fórmula. La disponibilidad real la manda la GPU, no la tabla.
export async function GET() {
  if (!isBridgeConfigured()) {
    return NextResponse.json({ object: "list", engine: { online: false }, data: [] });
  }

  const [models, catalog, health] = await Promise.all([
    listMediaModels(),
    getBridgeCatalog().catch(() => ({ models: [], loras: [] })),
    getBridgeHealth(),
  ]);

  const availability = new Map(catalog.models.map((entry) => [entry.id, entry.available]));

  const data = models.map((model) => {
    const config = model.media_config || {};
    const defaults = config.defaults || {};
    return {
      id: model.id,
      object: "model",
      modality: model.modality,
      display_name: model.display_name,
      // Sin catálogo del bridge (túnel caído) se asume disponible: la health
      // de abajo ya dice que el motor está offline.
      available: availability.get(model.upstream_model_id) ?? true,
      defaults,
      limits: config.limits || {},
      supports: config.supports || {},
      pricing: {
        base_credits: Number(model.media_base_credits),
        base_pixels: model.media_base_pixels,
        base_steps: model.media_base_steps,
        base_frames: model.media_base_frames,
        // Lo que costaría una generación con los valores por defecto.
        default_credits: mediaCredits(model, {
          width: Number(defaults.width) || 1024,
          height: Number(defaults.height) || 1024,
          steps: Number(defaults.steps) || 20,
          batch: 1,
          frames: model.modality === "video" ? Number(defaults.length) || null : null,
        }),
      },
    };
  });

  return NextResponse.json({
    object: "list",
    engine: {
      online: Boolean(health?.ok),
      queued: health?.queue?.queued ?? null,
      running: health?.queue?.running ?? null,
    },
    // LoRAs instaladas en la GPU. Se pasan por `loras: [{name, strength}]` en
    // el request; solo aplican a los modelos con supports.loras.
    loras: catalog.loras,
    data,
  });
}
