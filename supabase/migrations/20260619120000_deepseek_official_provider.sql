-- DeepSeek official API provider (OpenAI-compatible), pay-as-you-go per-token.
-- Context caching is automatic on DeepSeek's side and reported via
-- usage.prompt_tokens_details.cached_tokens; cache-hit tokens are billed at
-- cost_per_m_cache_read. DeepSeek has no separate cache-creation charge, so
-- cost_per_m_cache_write = 0 (cache-miss tokens are billed as normal input).
--
-- Pricing (official USD / 1M tokens), margin 1.20 (20% markup):
--   v4-flash : input(miss) 0.14   output 0.28  cache-hit 0.0028
--   v4-pro   : input(miss) 0.435  output 0.87  cache-hit 0.003625
-- Context 1M, max output 384K. Thinking mode default (reasoning capability).

INSERT INTO models (
  id, provider, display_name, upstream_model_id,
  cost_per_m_input, cost_per_m_output, cost_per_m_cache_read, cost_per_m_cache_write,
  margin, context_length, premium_request_cost, is_active, capabilities
) VALUES
  (
    'ds/deepseek-v4-flash', 'deepseek', 'DeepSeek V4 Flash', 'deepseek-v4-flash',
    0.14, 0.28, 0.0028, 0,
    1.20, 1000000, 0, true,
    '["tool_calling", "json_mode", "reasoning", "streaming", "system_message"]'::jsonb
  ),
  (
    'ds/deepseek-v4-pro', 'deepseek', 'DeepSeek V4 Pro', 'deepseek-v4-pro',
    0.435, 0.87, 0.003625, 0,
    1.20, 1000000, 0, true,
    '["tool_calling", "json_mode", "reasoning", "streaming", "system_message"]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  provider              = EXCLUDED.provider,
  display_name          = EXCLUDED.display_name,
  upstream_model_id     = EXCLUDED.upstream_model_id,
  cost_per_m_input      = EXCLUDED.cost_per_m_input,
  cost_per_m_output     = EXCLUDED.cost_per_m_output,
  cost_per_m_cache_read = EXCLUDED.cost_per_m_cache_read,
  cost_per_m_cache_write= EXCLUDED.cost_per_m_cache_write,
  margin                = EXCLUDED.margin,
  context_length        = EXCLUDED.context_length,
  premium_request_cost  = EXCLUDED.premium_request_cost,
  is_active             = EXCLUDED.is_active,
  capabilities          = EXCLUDED.capabilities;
