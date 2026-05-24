-- Add Gemini 3.5 Flash on RiftAI and standardize every r/ model to
-- 1 premium-request unit per call.

INSERT INTO public.models (
  id,
  provider,
  upstream_model_id,
  display_name,
  cost_per_m_input,
  cost_per_m_output,
  cost_per_m_cache_read,
  cost_per_m_cache_write,
  margin,
  is_active,
  premium_request_cost,
  capabilities
) VALUES (
  'r/gemini-3.5-flash',
  'riftai',
  'gemini-3.5-flash',
  'Gemini 3.5 Flash',
  0,
  0,
  0,
  0,
  1.0,
  true,
  1,
  '["tool_calling", "streaming", "system_message"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  upstream_model_id = EXCLUDED.upstream_model_id,
  display_name = EXCLUDED.display_name,
  cost_per_m_input = EXCLUDED.cost_per_m_input,
  cost_per_m_output = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write = EXCLUDED.cost_per_m_cache_write,
  margin = EXCLUDED.margin,
  is_active = EXCLUDED.is_active,
  premium_request_cost = EXCLUDED.premium_request_cost,
  capabilities = EXCLUDED.capabilities;

UPDATE public.models
SET premium_request_cost = 1
WHERE provider = 'riftai'
  AND id LIKE 'r/%';
