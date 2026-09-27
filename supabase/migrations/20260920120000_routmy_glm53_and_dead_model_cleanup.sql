-- ============================================================
-- rout.my (rt/) — GLM 5.3 family + retirada de modelos muertos
--
-- Verificado contra https://api.rout.my/v1/models el 2026-09-20:
-- upstream sirve 62 modelos de chat; la DB tenía 30, de los cuales 13
-- ya devolvían 403 "Model does not exist or is not supported".
--
-- 1) Alta de la familia GLM 5.3 (smoke-tested 200 OK, respetan el
--    system prompt, HTML intacto, emiten reasoning_content).
--    premium_request_cost sigue el criterio de la familia z-ai:
--      glm-5.3       token_multiplier 2.0  -> 2  (igual que glm-5/5.1/5.2)
--      glm-5.3-flash token_multiplier 0.7  -> 1  (igual que mimo-v2.5-pro)
--      glm-5.3-fast  token_multiplier 3.5  -> 4
--
-- 2) is_active = false para los 13 modelos que upstream ya no sirve.
--    Soft-delete, reversible: las filas y su historial de uso quedan.
--
-- Per-token cost_per_m se deja en 0 a propósito: los providers de
-- premium-pool cobran solo via premium_request_cost.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities,
  payg_credits_per_m_input, payg_credits_per_m_output, modality
) VALUES
  ('rt/z-ai/glm-5.3',       'routmy', 'z-ai/glm-5.3',       'GLM 5.3',       0, 0, 0, 0, 1.5500, true, 2.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/z-ai/glm-5.3-flash', 'routmy', 'z-ai/glm-5.3-flash', 'GLM 5.3 Flash', 0, 0, 0, 0, 1.5500, true, 1.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text'),
  ('rt/z-ai/glm-5.3-fast',  'routmy', 'z-ai/glm-5.3-fast',  'GLM 5.3 Fast',  0, 0, 0, 0, 1.5500, true, 4.00, '["tool_calling", "streaming", "system_message"]'::jsonb, 300, 2000, 'text')
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

-- Modelos retirados por upstream (403 verificado uno por uno el 2026-09-20)
UPDATE models
   SET is_active = false
 WHERE provider = 'routmy'
   AND id IN (
     'rt/deepseek/deepseek-chat-v3.1',
     'rt/deepseek/deepseek-r1-0528',
     'rt/deepseek/deepseek-v3.1-terminus',
     'rt/google/gemini-3.1-flash-lite',
     'rt/google/gemini-3.5-flash',
     'rt/minimax/minimax-m2.5',
     'rt/moonshotai/kimi-k2.5',
     'rt/nvidia/nemotron-3-ultra',
     'rt/nvidia/nemotron-3-ultra-limited',
     'rt/openai/gpt-5.3-chat',
     'rt/x-ai/grok-4.1-fast',
     'rt/x-ai/grok-4.20',
     'rt/z-ai/glm-4.6'
   );
