-- ============================================================
-- TrollLLM (t/) provider + cache-token billing columns
--
-- Context:
--   The previous Claude-serving provider c/ (lightningzeus) is retired.
--   Its catalog rows are removed; historical usage_logs entries with
--   model_id LIKE 'c/%' are preserved for accounting.
--
--   t/ (trolllm) is a pay-per-token OpenAI-compatible reseller fronting
--   Anthropic / OpenAI / Google. Upstream already applies prompt caching
--   on supported models, so we track cache read/write tokens separately
--   and bill them at their own per-million rates.
--
--   Premium request cost for the 11 new t/ models:
--     claude-opus-*   = 3
--     claude-sonnet-* = 2
--     everything else = 1  (haiku, gpt-5.x, gemini-3.1-pro)
-- ============================================================

-- 1. Drop c/ catalog entries.
DELETE FROM models WHERE provider = 'lightningzeus';

-- 2. Cache-pricing columns on models (USD per 1M cache-read/write tokens).
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS cost_per_m_cache_read  NUMERIC(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_m_cache_write NUMERIC(10,4) NOT NULL DEFAULT 0;

-- 3. Cache-token counters on usage_logs.
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;

-- 4. Insert TrollLLM models.
INSERT INTO models (
  id, provider, upstream_model_id, display_name,
  cost_per_m_input, cost_per_m_output,
  cost_per_m_cache_read, cost_per_m_cache_write,
  margin, is_active, premium_request_cost
) VALUES
  ('t/claude-sonnet-4',   'trolllm', 'claude-sonnet-4',   'Claude Sonnet 4',   3, 15, 0.30, 3.75, 1.55, true, 2),
  ('t/claude-sonnet-4.5', 'trolllm', 'claude-sonnet-4.5', 'Claude Sonnet 4.5', 3, 15, 0.30, 3.75, 1.55, true, 2),
  ('t/claude-sonnet-4.6', 'trolllm', 'claude-sonnet-4.6', 'Claude Sonnet 4.6', 3, 15, 0.30, 3.75, 1.55, true, 2),
  ('t/claude-opus-4.5',   'trolllm', 'claude-opus-4.5',   'Claude Opus 4.5',   5, 25, 0.50, 6.25, 1.55, true, 3),
  ('t/claude-opus-4.6',   'trolllm', 'claude-opus-4.6',   'Claude Opus 4.6',   5, 25, 0.50, 6.25, 1.55, true, 3),
  ('t/claude-haiku-4.5',  'trolllm', 'claude-haiku-4.5',  'Claude Haiku 4.5',  1, 5,  0.10, 1.25, 1.55, true, 1),
  ('t/gpt-5.2',           'trolllm', 'gpt-5.2',           'GPT-5.2',           3, 12, 0.30, 3.00, 1.55, true, 1),
  ('t/gpt-5.2-codex',     'trolllm', 'gpt-5.2-codex',     'GPT-5.2 Codex',     3, 12, 0.30, 3.00, 1.55, true, 1),
  ('t/gpt-5.3-codex',     'trolllm', 'gpt-5.3-codex',     'GPT-5.3 Codex',     3, 12, 0.30, 3.00, 1.55, true, 1),
  ('t/gpt-5.4',           'trolllm', 'gpt-5.4',           'GPT-5.4',           3, 12, 0.30, 3.00, 1.55, true, 1),
  ('t/gemini-3.1-pro',    'trolllm', 'gemini-3.1-pro',    'Gemini 3.1 Pro',    2, 8,  0.20, 2.00, 1.55, true, 1)
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
  premium_request_cost   = EXCLUDED.premium_request_cost;
