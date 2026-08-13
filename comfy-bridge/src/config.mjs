// Configuración del bridge. Todo por env; sin secretos en el repo.
//
// El repo es público (respaldo), así que BRIDGE_SECRET solo se define en el
// .env de la PC / en las variables de PM2, nunca aquí.

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name, fallback) {
  // Los valores de env pueden traer \r cuando se setean desde un pipe de
  // PowerShell; un \r suelto rompe `new URL()` y `fetch()`.
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : String(raw).trim();
}

export const config = {
  // Puerto del bridge. 8000 lo usa kiro-gateway, así que por defecto 8189.
  port: num("BRIDGE_PORT", 8189),
  host: str("BRIDGE_HOST", "127.0.0.1"),

  // Secreto compartido con aether-router. Sin él, el bridge no arranca.
  secret: str("BRIDGE_SECRET", ""),

  comfyUrl: str("COMFY_URL", "http://127.0.0.1:8188").replace(/\/+$/, ""),

  // La GPU es una sola: más de un job a la vez solo empeora la latencia.
  concurrency: num("BRIDGE_CONCURRENCY", 1),
  // Cola máxima antes de rechazar con 429 (el router lo traduce a "ocupado").
  maxQueue: num("BRIDGE_MAX_QUEUE", 24),

  // Cuánto se guardan los bytes de un job terminado antes de liberarlos.
  jobTtlMs: num("BRIDGE_JOB_TTL_MS", 20 * 60 * 1000),
  // Techo de un job individual (imagen larga o video de varios minutos).
  jobTimeoutMs: num("BRIDGE_JOB_TIMEOUT_MS", 15 * 60 * 1000),

  // Body máximo aceptado (init image en base64 pesa lo suyo).
  maxBodyBytes: num("BRIDGE_MAX_BODY_BYTES", 16 * 1024 * 1024),
  // Techo por asset devuelto, para no reventar la RAM con videos largos.
  maxAssetBytes: num("BRIDGE_MAX_ASSET_BYTES", 96 * 1024 * 1024),
};

export function assertConfig() {
  if (!config.secret || config.secret.length < 16) {
    throw new Error(
      "BRIDGE_SECRET no está definido (o es < 16 chars). Definilo antes de arrancar el bridge.",
    );
  }
}
