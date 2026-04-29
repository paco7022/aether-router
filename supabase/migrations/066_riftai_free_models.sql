-- ============================================================
-- RiftAI free models (DeepSeek, Kimi, Gemini Flash) + h/gemini-3-flash-preview.
--
-- Make r/ DeepSeek, Kimi, gemini-3-flash-preview, and h/gemini-3-flash-preview
-- zero-cost so they route as free models while we promote them. The route
-- handler treats any premium-provider model with cost_per_m_input=0 AND
-- premium_request_cost=0 as a free-pool bypass (no credits, no premium-request
-- budget consumed).
--
-- NOTE: an earlier draft of this migration also deleted an/, g/, and a/
-- providers. That part was dropped because a/deepseek-v3.2 is still the
-- 200k/day-per-user free pool that the chat/completions route depends on.
-- Provider retirement will happen in a separate migration that also removes
-- the free-pool block in code.
-- ============================================================

-- 1. RiftAI models go free.
UPDATE models
SET cost_per_m_input       = 0,
    cost_per_m_output      = 0,
    cost_per_m_cache_read  = 0,
    cost_per_m_cache_write = 0,
    margin                 = 1.0,
    premium_request_cost   = 0
WHERE id IN (
  'r/deepseek-v4-flash',
  'r/deepseek-v4-pro',
  'r/kimi-k2.6',
  'r/gemini-3-flash-preview'
);

-- 2. Hapuppy gemini-3-flash-preview also goes free.
UPDATE models
SET cost_per_m_input       = 0,
    cost_per_m_output      = 0,
    cost_per_m_cache_read  = 0,
    cost_per_m_cache_write = 0,
    margin                 = 1.0,
    premium_request_cost   = 0
WHERE id = 'h/gemini-3-flash-preview';
