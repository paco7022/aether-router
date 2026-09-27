-- ============================================================
-- rout.my (rt/) — alta de catálogo no-Claude/no-GPT + realineación de precios
--
-- Verificado contra GET {ROUTMY_BASE_URL}/models el 2026-09-20 y con
-- smoke test real (POST /chat/completions) modelo por modelo.
--
-- ── Regla de precio ──────────────────────────────────────────
-- premium_request_cost = token_multiplier del catálogo upstream, 1:1.
-- Es la regla original (ver 20260607120000) y la que siguieron
-- 20260622120000 (gpt-5.5 → x7) y 20260708130000 (grok-4.5 → x3):
-- esos valores NO eran un markup, eran el multiplicador de entonces.
-- rout.my ha movido precios desde entonces, así que las filas viejas
-- quedaron desfasadas en ambos sentidos. Aquí se re-sincronizan.
--
-- ── Altas ────────────────────────────────────────────────────
-- 17 activas: respondieron 200, respetaron el system prompt y
-- devolvieron el literal <div> intacto (sin escapar ni filtrar).
--  7 apagadas (is_active=false): fallaron 4/4 intentos seguidos, no
--    es caída transitoria. Se registran para que activarlas después
--    sea solo un flag, en vez de volver a redescubrir el catálogo:
--      gemini-3.5-flash-lite, qwen3.8-max  → 503 "no active capacity in the pool"
--      gemma-4-26b-a4b-it, gemma-4-31b-it,
--      qwen3.8-flash                       → 503 "model is currently overloaded"
--      qwen3.7-max                         → 503 "No providers available for this model"
--      kimi-k3-n9                          → 403 "This model requires a higher plan"
--
-- Excluidos a propósito: los 10 anthropic/* y los 8 openai/* nuevos.
-- Claude en reseller necesita gate paid-only + claude_activated y
-- verificación previa de que no sea fake (ver t/, bl/, sh/).
--
-- Convenciones heredadas: premium-pool ⇒ cost_per_m_* = 0 (se cobra
-- 1 crédito/request + premium_request_cost contra el pool diario);
-- margin 1.55; payg 500/4000 para Gemini, 300/2000 el resto.
-- Perplexity Sonar va sin tool_calling: son modelos con búsqueda
-- integrada y no exponen function calling.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities,
  payg_credits_per_m_input, payg_credits_per_m_output, modality
) VALUES
  -- ── activos ────────────────────────────────────────────────
  ('rt/deepseek/deepseek-v4-flash-0731',   'routmy', 'deepseek/deepseek-v4-flash-0731',   'DeepSeek V4 Flash (0731)',   0, 0, 0, 0, 1.5500, true,  0.50, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/deepseek/deepseek-v4-pro-0813',     'routmy', 'deepseek/deepseek-v4-pro-0813',     'DeepSeek V4 Pro (0813)',     0, 0, 0, 0, 1.5500, true,  1.25, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/deepseek/deepseek-v4.1-flash',      'routmy', 'deepseek/deepseek-v4.1-flash',      'DeepSeek V4.1 Flash',        0, 0, 0, 0, 1.5500, true,  1.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/google/gemini-3.6-flash',           'routmy', 'google/gemini-3.6-flash',           'Gemini 3.6 Flash',           0, 0, 0, 0, 1.5500, true,  2.75, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb, 500, 4000, 'text'),
  ('rt/google/gemini-3.7-flash',           'routmy', 'google/gemini-3.7-flash',           'Gemini 3.7 Flash',           0, 0, 0, 0, 1.5500, true,  1.40, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb, 500, 4000, 'text'),
  ('rt/google/gemini-3.8-flash',           'routmy', 'google/gemini-3.8-flash',           'Gemini 3.8 Flash',           0, 0, 0, 0, 1.5500, true,  1.40, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb, 500, 4000, 'text'),
  ('rt/minimax/minimax-m3',                'routmy', 'minimax/minimax-m3',                'MiniMax M3',                 0, 0, 0, 0, 1.5500, true,  1.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/moonshotai/kimi-k2.7-code',         'routmy', 'moonshotai/kimi-k2.7-code',         'Kimi K2.7 Code',             0, 0, 0, 0, 1.5500, true,  1.65, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/moonshotai/kimi-k3',                'routmy', 'moonshotai/kimi-k3',                'Kimi K3',                    0, 0, 0, 0, 1.5500, true,  6.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/moonshotai/kimi-k3-fw',             'routmy', 'moonshotai/kimi-k3-fw',             'Kimi K3 FW',                 0, 0, 0, 0, 1.5500, true,  4.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/perplexity/sonar',                  'routmy', 'perplexity/sonar',                  'Sonar',                      0, 0, 0, 0, 1.5500, true,  1.25, '["streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/perplexity/sonar-pro',              'routmy', 'perplexity/sonar-pro',              'Sonar Pro',                  0, 0, 0, 0, 1.5500, true,  4.75, '["streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/perplexity/sonar-reasoning-pro',    'routmy', 'perplexity/sonar-reasoning-pro',    'Sonar Reasoning Pro',        0, 0, 0, 0, 1.5500, true,  3.25, '["streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/qwen/qwen3.8-2.4t-a95b',            'routmy', 'qwen/qwen3.8-2.4t-a95b',            'Qwen 3.8 2.4T A95B',         0, 0, 0, 0, 1.5500, true,  1.50, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/tencent/hy4-preview',               'routmy', 'tencent/hy4-preview',               'Hunyuan 4 (Preview)',        0, 0, 0, 0, 1.5500, true,  1.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/x-ai/grok-4.6',                     'routmy', 'x-ai/grok-4.6',                     'Grok 4.6',                   0, 0, 0, 0, 1.5500, true,  2.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/xiaomi/mimo-v2.5',                  'routmy', 'xiaomi/mimo-v2.5',                  'MiMo V2.5',                  0, 0, 0, 0, 1.5500, true,  0.50, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  -- ── staged, apagados (upstream sin capacidad / plan insuficiente) ──
  ('rt/google/gemini-3.5-flash-lite',      'routmy', 'google/gemini-3.5-flash-lite',      'Gemini 3.5 Flash Lite',      0, 0, 0, 0, 1.5500, false, 1.00, '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb, 500, 4000, 'text'),
  ('rt/google/gemma-4-26b-a4b-it',         'routmy', 'google/gemma-4-26b-a4b-it',         'Gemma 4 26B A4B',            0, 0, 0, 0, 1.5500, false, 0.80, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/google/gemma-4-31b-it',             'routmy', 'google/gemma-4-31b-it',             'Gemma 4 31B',                0, 0, 0, 0, 1.5500, false, 0.80, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/moonshotai/kimi-k3-n9',             'routmy', 'moonshotai/kimi-k3-n9',             'Kimi K3 N9',                 0, 0, 0, 0, 1.5500, false, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/qwen/qwen3.7-max',                  'routmy', 'qwen/qwen3.7-max',                  'Qwen 3.7 Max',               0, 0, 0, 0, 1.5500, false, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/qwen/qwen3.8-flash',                'routmy', 'qwen/qwen3.8-flash',                'Qwen 3.8 Flash',             0, 0, 0, 0, 1.5500, false, 0.80, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/qwen/qwen3.8-max',                  'routmy', 'qwen/qwen3.8-max',                  'Qwen 3.8 Max',               0, 0, 0, 0, 1.5500, false, 1.50, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text')
ON CONFLICT (id) DO UPDATE SET
  provider                  = EXCLUDED.provider,
  upstream_model_id         = EXCLUDED.upstream_model_id,
  display_name              = EXCLUDED.display_name,
  cost_per_m_input          = EXCLUDED.cost_per_m_input,
  cost_per_m_output         = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read     = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write    = EXCLUDED.cost_per_m_cache_write,
  margin                    = EXCLUDED.margin,
  is_active                 = EXCLUDED.is_active,
  premium_request_cost      = EXCLUDED.premium_request_cost,
  capabilities              = EXCLUDED.capabilities,
  payg_credits_per_m_input  = EXCLUDED.payg_credits_per_m_input,
  payg_credits_per_m_output = EXCLUDED.payg_credits_per_m_output,
  modality                  = EXCLUDED.modality;

-- ============================================================
-- Realineación de precios de las filas ya existentes.
-- Izquierda = valor viejo en DB, derecha = token_multiplier actual.
--
-- Subimos (estábamos cobrando por debajo del coste upstream):
--   kimi-k2.6          1    -> 1.5
--   kimi-k3-moonshot   5    -> 6
-- Bajamos (estábamos cobrando de más a los usuarios):
--   gpt-5.5            7    -> 5.5
--   gpt-5.4            3    -> 2
--   gpt-5.3-codex      3    -> 2
--   grok-4.5           3    -> 2
--   grok-4.3           2    -> 1.5
--   deepseek-v4-pro    1    -> 0.7
--   mimo-v2.5-pro      1    -> 0.7
--   glm-4.7            2    -> 1.75
--   glm-5.3-flash      1    -> 0.7   (corrige el alta de 20260920120000)
--   glm-5.3-fast       4    -> 3.5   (corrige el alta de 20260920120000)
--
-- Sin cambio (ya cuadraban): deepseek-v4-flash 0.5, gemini-2.5-pro 4,
-- gemini-3.1-pro-preview 5, minimax-m2.7 1, glm-5 / glm-5.1 /
-- glm-5.2 / glm-5.3 todos en 2.
--
-- Las filas apagadas por 20260920120000 se dejan con su precio viejo:
-- están inactivas y no facturan.
-- ============================================================

UPDATE models AS m
   SET premium_request_cost = v.cost
  FROM (VALUES
    ('rt/moonshotai/kimi-k2.6',        1.50),
    ('rt/moonshotai/kimi-k3-moonshot', 6.00),
    ('rt/openai/gpt-5.5',              5.50),
    ('rt/openai/gpt-5.4',              2.00),
    ('rt/openai/gpt-5.3-codex',        2.00),
    ('rt/x-ai/grok-4.5',               2.00),
    ('rt/x-ai/grok-4.3',               1.50),
    ('rt/deepseek/deepseek-v4-pro',    0.70),
    ('rt/xiaomi/mimo-v2.5-pro',        0.70),
    ('rt/z-ai/glm-4.7',                1.75),
    ('rt/z-ai/glm-5.3-flash',          0.70),
    ('rt/z-ai/glm-5.3-fast',           3.50)
  ) AS v(id, cost)
 WHERE m.id = v.id
   AND m.provider = 'routmy';
