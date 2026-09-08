import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// The active model list changes rarely (admin toggles), but /v1/models is
// polled on every dashboard load and by API clients. Cache the built payload
// in-process with a short TTL so we stop seq-scanning the models table on
// every request, and let the edge/CDN cache the response for a minute too.
const CACHE_TTL_MS = 60_000;
let cache: { body: unknown; expires: number } | null = null;

export async function GET() {
  if (cache && cache.expires > Date.now()) {
    return NextResponse.json(cache.body, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  }

  const supabase = createAdminClient();

  // `modality` es una columna nueva (migración de media). Si el deploy de
  // código va por delante del de la DB, pedirla haría fallar TODO /v1/models,
  // que es el endpoint más crítico del router. Se reintenta sin ella.
  type ModelRow = {
    id: string;
    display_name?: string | null;
    capabilities?: unknown;
    modality?: string | null;
  };
  let { data: models, error } = await supabase
    .from("models")
    .select("id, display_name, capabilities, modality")
    .eq("is_active", true)
    .order("id")
    .overrideTypes<ModelRow[]>();

  if (error) {
    ({ data: models, error } = await supabase
      .from("models")
      .select("id, display_name, capabilities")
      .eq("is_active", true)
      .order("id")
      .overrideTypes<ModelRow[]>());
  }

  if (error) {
    return NextResponse.json(
      { error: { message: "Failed to fetch models", type: "server_error" } },
      { status: 500 }
    );
  }

  // OpenAI-compatible /v1/models response format, extended with capabilities
  const data = (models || []).map((m) => ({
    id: m.id,
    object: "model",
    created: 0,
    owned_by: "aether-router",
    // Nombre de catálogo. Es la etiqueta que ya se muestra en la web, así que
    // no agrega exposición — pero es lo que necesita el selector del chat para
    // no leer la tabla `models` directamente desde el browser.
    display_name: m.display_name ?? m.id,
    capabilities: m.capabilities ?? ["streaming", "system_message"],
    // "image"/"video" no sirven en /v1/chat/completions; se exponen acá para
    // que un cliente pueda filtrarlos en vez de descubrirlo con un 400.
    modality: m.modality ?? "text",
  }));

  const body = { object: "list", data };
  cache = { body, expires: Date.now() + CACHE_TTL_MS };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
