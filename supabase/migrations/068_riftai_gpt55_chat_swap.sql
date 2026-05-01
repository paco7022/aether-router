-- ============================================================
-- RiftAI: register `r/gpt-5.5` (chat) and disable `r/gpt-5.5-pro`.
--
-- RiftAI exposes `gpt-5.5-pro` only on the legacy `/v1/completions`
-- endpoint and rejects it on `/v1/chat/completions` ("This is not a
-- chat model"). Our proxy only speaks /chat/completions, so the model
-- is effectively dead — deactivate it. The base `gpt-5.5` IS a chat
-- model; add it.
--
-- premium_request_cost = 5 (vs gpt-5.5-pro=25, ~5x cheaper base tier
-- matching the OpenAI list-price ratio between gpt-5 and gpt-5-pro).
-- Tune in a follow-up migration once real usage costs settle.
-- ============================================================

INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost, capabilities
) VALUES
  ('r/gpt-5.5', 'riftai', 'gpt-5.5', 'GPT 5.5', 2.5000, 10.0000, 0.2500, 0.0000, 1.5500, true, 5.00,
   '["tool_calling", "vision", "streaming", "system_message", "json_mode"]'::jsonb)
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

UPDATE models SET is_active = false WHERE id = 'r/gpt-5.5-pro';
