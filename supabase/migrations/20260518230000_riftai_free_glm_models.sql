-- ============================================================
-- RiftAI (r/) free GLM models — glm-4.7, glm-5v-turbo, glm-5.1, glm-4.6
--
-- Added free "for now" while we promote them. Per the free-model
-- convention (see 066_riftai_free_models.sql), a premium-provider
-- model with cost_per_m_input = 0 AND premium_request_cost = 0 is
-- treated by the chat/completions route as a free-pool bypass: no
-- credits charged, no premium-request budget consumed.
--
-- Upstream ids (riftai.su/v1) are plain, same shape as 061_riftai_provider.
-- glm-5v-turbo is a vision model -> include the "vision" capability.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('r/glm-4.7',      'riftai', 'glm-4.7',      'GLM 4.7',      0, 0, 0, 0, 1.0, true, 0, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/glm-5v-turbo', 'riftai', 'glm-5v-turbo', 'GLM 5V Turbo', 0, 0, 0, 0, 1.0, true, 0, '["tool_calling", "vision", "streaming", "system_message"]'::jsonb),
  ('r/glm-5.1',      'riftai', 'glm-5.1',      'GLM 5.1',      0, 0, 0, 0, 1.0, true, 0, '["tool_calling", "streaming", "system_message"]'::jsonb),
  ('r/glm-4.6',      'riftai', 'glm-4.6',      'GLM 4.6',      0, 0, 0, 0, 1.0, true, 0, '["tool_calling", "streaming", "system_message"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  provider               = EXCLUDED.provider,
  upstream_model_id      = EXCLUDED.upstream_model_id,
  display_name           = EXCLUDED.display_name,
  cost_per_m_input       = EXCLUDED.cost_per_m_input,
  cost_per_m_output      = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read  = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write = EXCLUDED.cost_per_m_cache_write,
  margin                 = EXCLUDED.margin,
  is_active              = EXCLUDED.is_active,
  premium_request_cost   = EXCLUDED.premium_request_cost,
  capabilities           = EXCLUDED.capabilities;
