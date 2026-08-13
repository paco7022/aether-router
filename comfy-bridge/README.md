# comfy-bridge

Puente entre **Aether Router** y el **ComfyUI local** (RTX 5090). Es el único
componente que habla con ComfyUI: el router nunca ve la API cruda, y ComfyUI
nunca queda expuesto a internet.

```
cliente → api.aether-ai.dev → CF Worker → app Next (PC o Cloudflare)
                                              │
                                              └── https://comfy.aether-ai.dev
                                                      (cloudflared)
                                                          │
                                                  comfy-bridge :8189
                                                          │
                                                    ComfyUI :8188  → GPU
```

## Qué hace

- **Auth por secreto compartido** (`x-aether-bridge-secret`), comparado en
  tiempo constante. Sin `BRIDGE_SECRET` el proceso no arranca.
- **Cola de concurrencia 1**: hay una sola GPU. Los jobs extra esperan; pasado
  `BRIDGE_MAX_QUEUE` responde 429.
- **Plantillas de workflow** por modelo (`src/catalog.mjs` + `src/workflows.mjs`).
  El caller manda parámetros normalizados (prompt, tamaño, steps, seed…), no
  grafos de ComfyUI.
- **Validación y clamp** de parámetros contra los límites de cada modelo.
- Devuelve los bytes del resultado; el router los sube a Supabase Storage.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/ping` | Sin auth. Health check del túnel. |
| `GET` | `/health` | Estado de ComfyUI, VRAM y cola. |
| `GET` | `/catalog` | Modelos + defaults/límites + LoRAs disponibles. |
| `POST` | `/jobs` | Encola una generación. 202 con el job. |
| `GET` | `/jobs/:id` | Estado del job. |
| `GET` | `/jobs/:id/assets/:i` | Bytes del resultado (solo si terminó). |
| `DELETE` | `/jobs/:id` | Cancela (saca de la cola o interrumpe). |

## Catálogo

Es **dinámico**: se arma leyendo los checkpoints que ComfyUI tiene cargados
(`/object_info`), así que un `.safetensors` nuevo en `models/checkpoints`
aparece solo. El id es un slug del nombre de archivo
(`SDXL\hassakuXLIllustrious_v22-013.safetensors` → `hassaku-xlillustrious-v22`).

Los defaults se deducen del nombre:

- `lightning|turbo|hyper|lcm` → 6 steps, cfg 1.5, dpmpp_sde/karras.
- `illustrious|noobai|anime|wai|hassaku|…` → 832×1216, 28 steps, cfg 5, euler_a
  + negativo de anime.
- el resto → 1024², 30 steps, cfg 4.5, dpmpp_2m/karras.

Encima hay dos capas a mano en `src/catalog.mjs`: `CURATED` (modelos que no son
un checkpoint suelto, como el video Wan 2.2) y `OVERRIDES` / `DISPLAY_OVERRIDES`
(ajustes y nombres bonitos por archivo). `EXCLUDED` saca los que ningún builder
sabe armar todavía (Z-Image).

Para que un modelo sea llamable desde el router hace falta además su fila en la
tabla `models`. Se genera desde este catálogo:

```bash
BRIDGE_SECRET=... node scripts/generate-media-models-sql.mjs > supabase/migrations/AAAAMMDDHHMMSS_media_models.sql
```

Las LoRAs (`/catalog` → `loras`) no necesitan nada: se pasan por request como
`loras: [{name, strength}]`, hasta 4.

## Correr

```bash
# ComfyUI aparte, en :8188
cd C:\AetherAI\ComfyUI_windows_portable_nvidia\ComfyUI_windows_portable
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --port 8188 --listen 127.0.0.1

# el bridge
BRIDGE_SECRET=... node src/server.mjs
```

Bajo PM2 (junto al router), desde `aether-router/`:

```bash
pm2 start ecosystem.config.cjs --only comfyui,comfy-bridge
```

### Variables

| Variable | Default | Para qué |
| --- | --- | --- |
| `BRIDGE_SECRET` | — | **Obligatoria**, mín. 16 chars. Igual a `COMFY_BRIDGE_SECRET` del router. |
| `BRIDGE_PORT` | `8189` | 8000 lo ocupa kiro-gateway. |
| `BRIDGE_HOST` | `127.0.0.1` | No exponer directo: publicar por cloudflared. |
| `COMFY_URL` | `http://127.0.0.1:8188` | ComfyUI. |
| `BRIDGE_MAX_QUEUE` | `24` | Cola máxima antes de 429. |
| `BRIDGE_JOB_TIMEOUT_MS` | `900000` | Techo por job (15 min). |
| `BRIDGE_JOB_TTL_MS` | `1200000` | Cuánto se guardan los bytes tras terminar. |

## Smoke test

```bash
BRIDGE_SECRET=... node scripts/smoke.mjs anime-xl "a red fox in the snow"
```

Guarda el resultado en `out/`.

## Notas

- El estado de los jobs vive **en RAM**. Si el bridge se reinicia, el router ve
  el job como perdido y devuelve los créditos. La verdad de cara al usuario es
  la tabla `media_jobs` de Supabase, no esto.
- Los checkpoints SDXL están en un subdirectorio, así que ComfyUI los expone
  como `SDXL\nombre.safetensors`. El nombre en el catálogo tiene que coincidir
  exactamente con lo que devuelve `/object_info`.
- Las imágenes de referencia (img2img / image-to-video) se validan por
  magic-bytes, no por el content-type declarado.
