-- ============================================================
-- Generación de imágenes y video (provider `comfy`, GPU propia)
--
-- El motor es la PC de casa: ComfyUI sobre una RTX 5090, expuesta al router
-- por el comfy-bridge (ver comfy-bridge/README.md). A diferencia del resto de
-- providers, acá no hay tokens: se cobra por imagen / por clip.
--
-- 1) models gana `modality` + columnas de precio de media. Se reusa la tabla
--    `models` a propósito: el panel admin, /v1/models y los toggles is_active
--    ya funcionan sobre ella. La ruta de chat rechaza modality <> 'text'.
--
-- 2) media_jobs: cola persistente + historial. El bridge guarda su propio
--    estado en RAM; esta tabla es la verdad para el usuario (y la que permite
--    refundar si la PC se cae a mitad de camino).
--
-- 3) bucket privado `media` con el mismo patrón de rutas y RLS que
--    `chat-uploads` ({user_id}/... como primer segmento).
--
-- Precios (créditos, CREDITS_PER_USD = 10000 → 500 créditos = $0.05):
--   img/*            500 por imagen en su configuración de referencia
--   vid/wan-2.2-5b  3000 por clip 0.9MP 49f @ 30 steps ($0.30)
--
-- Precio de arranque puesto por el owner (2026-08-02): 500 planos por imagen,
-- a ajustar con datos de uso. El video NO va a 500 porque un clip de 5s ocupa
-- la GPU ~13× más que una imagen de Flux (medido: imagen 1024²/20 steps = 27s;
-- clip 1280×704/49f/30 steps ≈ 5-6 min); 3000 sigue estando por debajo de la
-- paridad por tiempo de GPU.
--
-- Cambiar precios es un UPDATE, no un deploy:
--   UPDATE models SET media_base_credits = X WHERE id = 'img/flux-dev';
-- El costo real escala con píxeles/steps/frames en src/lib/media-credits.ts.
-- ============================================================

-- ── 1) Columnas de media en models ────────────────────────────
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS modality           text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_base_credits numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_base_pixels  bigint,
  ADD COLUMN IF NOT EXISTS media_base_steps   integer,
  ADD COLUMN IF NOT EXISTS media_base_frames  integer,
  ADD COLUMN IF NOT EXISTS media_config       jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'models_modality_check') THEN
    ALTER TABLE models
      ADD CONSTRAINT models_modality_check CHECK (modality IN ('text', 'image', 'video'));
  END IF;
END $$;

COMMENT ON COLUMN models.modality IS
  'text = modelo de chat (/v1/chat/completions). image/video = generación de media (/v1/media/jobs, /v1/images/generations).';
COMMENT ON COLUMN models.media_base_credits IS
  'Créditos por unidad base (una imagen a media_base_pixels y media_base_steps, o un clip de media_base_frames).';
COMMENT ON COLUMN models.media_config IS
  'Defaults/limits/supports que la UI usa para armar el formulario. Espejo del catálogo del bridge; el bridge sigue siendo quien valida.';

CREATE INDEX IF NOT EXISTS idx_models_modality ON models(modality) WHERE modality <> 'text';

-- ── 2) Cola + historial de jobs ───────────────────────────────
CREATE TABLE IF NOT EXISTS media_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- NULL cuando el job vino del dashboard (sesión) en vez de una API key.
  api_key_id       uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  model_id         text NOT NULL,
  kind             text NOT NULL DEFAULT 'image',
  status           text NOT NULL DEFAULT 'queued',
  -- id del job dentro del bridge; NULL hasta que el bridge lo acepta.
  bridge_job_id    text,
  prompt           text NOT NULL DEFAULT '',
  negative_prompt  text,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  seed             bigint,
  width            integer,
  height           integer,
  steps            integer,
  frames           integer,
  -- Créditos retenidos al encolar; se devuelven si el job falla.
  credits_reserved bigint NOT NULL DEFAULT 0,
  credits_charged  bigint NOT NULL DEFAULT 0,
  refunded         boolean NOT NULL DEFAULT false,
  -- [{path, content_type, size, width, height}] dentro del bucket `media`.
  assets           jsonb NOT NULL DEFAULT '[]'::jsonb,
  error            text,
  duration_ms      integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_jobs_kind_check') THEN
    ALTER TABLE media_jobs
      ADD CONSTRAINT media_jobs_kind_check CHECK (kind IN ('image', 'video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_jobs_status_check') THEN
    ALTER TABLE media_jobs
      ADD CONSTRAINT media_jobs_status_check
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_jobs_user_created ON media_jobs(user_id, created_at DESC);
-- Para el barrido de jobs zombis (el bridge se reinició y nadie los cerró).
CREATE INDEX IF NOT EXISTS idx_media_jobs_open ON media_jobs(status, created_at)
  WHERE status IN ('queued', 'running');

ALTER TABLE media_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_jobs_select_own" ON media_jobs;
CREATE POLICY "media_jobs_select_own" ON media_jobs
  FOR SELECT USING (auth.uid() = user_id);

-- Sin políticas de INSERT/UPDATE/DELETE a propósito: solo el service-role del
-- router escribe acá (crear un job significa cobrar créditos).

DROP TRIGGER IF EXISTS media_jobs_set_updated_at ON media_jobs;

CREATE OR REPLACE FUNCTION public.media_jobs_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER media_jobs_set_updated_at
  BEFORE UPDATE ON media_jobs
  FOR EACH ROW EXECUTE FUNCTION public.media_jobs_touch_updated_at();

-- ── 3) Bucket privado para los resultados ─────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  false,
  120 * 1024 * 1024,  -- un clip de Wan puede pesar bastante
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Mismo patrón que chat-uploads: el primer segmento del path es el uid.
-- El router sirve todo con signed URLs de service-role; esto es la red de
-- seguridad para que nadie lea la carpeta de otro con su propio token.
DROP POLICY IF EXISTS "media_select_own" ON storage.objects;
CREATE POLICY "media_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'media'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

DROP POLICY IF EXISTS "media_delete_own" ON storage.objects;
CREATE POLICY "media_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'media'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

-- ── 4) Catálogo inicial ───────────────────────────────────────
-- upstream_model_id = id del workflow en comfy-bridge/src/catalog.mjs.
-- cost_per_m_* quedan en 0: acá no hay tokens, el precio vive en media_*.
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output, margin,
  is_active, context_length, capabilities,
  modality, media_base_credits, media_base_pixels, media_base_steps, media_base_frames, media_config
) VALUES
  (
    'img/flux-dev', 'comfy', 'flux-dev', 'FLUX.1 dev',
    0, 0, 1.0, true, NULL, '["image_generation"]'::jsonb,
    'image', 500, 1048576, 20, NULL,
    '{"defaults":{"width":1024,"height":1024,"steps":20,"cfg":1,"guidance":3.5,"sampler":"euler","scheduler":"simple"},"limits":{"maxSteps":50,"maxPixels":2359296,"maxBatch":4},"supports":{"negative":false,"img2img":true,"loras":true}}'::jsonb
  ),
  (
    'img/anime-xl', 'comfy', 'anime-xl', 'Illustrious XL (anime)',
    0, 0, 1.0, true, NULL, '["image_generation"]'::jsonb,
    'image', 500, 1048576, 28, NULL,
    '{"defaults":{"width":832,"height":1216,"steps":28,"cfg":5,"sampler":"euler_ancestral","scheduler":"normal"},"limits":{"maxSteps":60,"maxPixels":2359296,"maxBatch":4},"supports":{"negative":true,"img2img":true,"loras":true}}'::jsonb
  ),
  (
    'img/realism-xl', 'comfy', 'realism-xl', 'Juggernaut XL (realismo)',
    0, 0, 1.0, true, NULL, '["image_generation"]'::jsonb,
    'image', 500, 1048576, 30, NULL,
    '{"defaults":{"width":1024,"height":1024,"steps":30,"cfg":4.5,"sampler":"dpmpp_2m","scheduler":"karras"},"limits":{"maxSteps":60,"maxPixels":2359296,"maxBatch":4},"supports":{"negative":true,"img2img":true,"loras":true}}'::jsonb
  ),
  (
    'img/realism-xl-fast', 'comfy', 'realism-xl-fast', 'RealVis XL Lightning',
    0, 0, 1.0, true, NULL, '["image_generation"]'::jsonb,
    'image', 500, 1048576, 6, NULL,
    '{"defaults":{"width":1024,"height":1024,"steps":6,"cfg":1.5,"sampler":"dpmpp_sde","scheduler":"karras"},"limits":{"maxSteps":12,"maxPixels":2359296,"maxBatch":4},"supports":{"negative":true,"img2img":true,"loras":true}}'::jsonb
  ),
  (
    'vid/wan-2.2-5b', 'comfy', 'wan-2.2-5b', 'Wan 2.2 TI2V 5B (video)',
    0, 0, 1.0, true, NULL, '["video_generation"]'::jsonb,
    'video', 3000, 901120, 30, 49,
    '{"defaults":{"width":1280,"height":704,"length":49,"fps":24,"steps":30,"cfg":5,"shift":8,"sampler":"uni_pc","scheduler":"simple"},"limits":{"maxSteps":40,"maxPixels":901120,"maxLength":121,"maxBatch":1},"supports":{"negative":true,"i2v":true,"loras":false}}'::jsonb
  )
ON CONFLICT (id) DO UPDATE
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

-- PAYG no aplica a media (no hay tokens): que quede explícito en 0.
UPDATE models
SET payg_credits_per_m_input = 0, payg_credits_per_m_output = 0
WHERE provider = 'comfy';
