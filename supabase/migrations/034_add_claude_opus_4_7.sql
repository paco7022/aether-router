-- ============================================================
-- Add Claude Opus 4.7 via TrollLLM (t/)
--
-- Same pricing as 4.6: $5/M in, $25/M out, $0.5/M cache read,
-- $6.25/M cache write. Premium request cost: 3 (like other Opus).
-- ============================================================

INSERT INTO models (
  id, provider, display_name, upstream_model_id,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, premium_request_cost,
  is_active, capabilities
) VALUES (
  't/claude-opus-4.7', 'trolllm', 'Claude Opus 4.7', 'claude-opus-4.7',
  5.0000, 25.0000,
  0.5000, 6.2500,
  1.5500, 3.00,
  true,
  '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
