-- ============================================================
-- Model capabilities
--
-- Adds a JSONB column to track what each model supports so that
-- the API can expose this information to consumers and the router
-- can validate feature usage before forwarding.
--
-- Capabilities are stored as a JSONB array of strings:
--   tool_calling   — function/tool calling support
--   vision         — image/multimodal input support
--   web_search     — built-in web search / grounding
--   streaming      — SSE streaming support
--   json_mode      — structured JSON output mode
--   system_message — system/developer message support
--   reasoning      — extended thinking / chain-of-thought
--   pdf_input      — direct PDF file input support
-- ============================================================

-- 1. Add the capabilities column (default: text-only chat with streaming)
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '["streaming", "system_message"]'::jsonb;

-- 2. Assign capabilities to existing models based on upstream provider knowledge.

-- ── Airforce models ────────────────────────────────────────────
-- These are uncensored proxies; upstream support varies per model family.
-- Defaulting to safe known capabilities for each upstream model.

-- GPT-5.4 via airforce: tool calling, vision, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id = 'gpt-5.4';

-- Claude Sonnet 4.5/4.6 Uncensored: tool calling, vision, streaming, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
WHERE id IN ('claude-sonnet-4.6-uncensored', 'claude-sonnet-4.5-uncensored');

-- Claude Opus 4.5/4.6 Uncensored: tool calling, vision, streaming, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
WHERE id IN ('claude-opus-4.5-uncensored', 'claude-opus-4.6-uncensored');

-- Gemini 3 Flash / 3.1 Pro via airforce: tool calling, vision, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id IN ('gemini-3-flash', 'gemini-3.1-pro');

-- DeepSeek R1: reasoning model, streaming, system
UPDATE models SET capabilities = '["streaming", "system_message", "reasoning"]'::jsonb
WHERE id = 'deepseek-r1';

-- DeepSeek V3.2 / V3.2 Speciale: tool calling, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id IN ('deepseek-v3.2', 'deepseek-v3.2-speciale');

-- Kimi K2.5 / K2-0905: tool calling, streaming, system
UPDATE models SET capabilities = '["tool_calling", "streaming", "system_message"]'::jsonb
WHERE id IN ('kimi-k2.5', 'kimi-k2-0905');

-- Grok models: tool calling, streaming, system
UPDATE models SET capabilities = '["tool_calling", "streaming", "system_message"]'::jsonb
WHERE id IN ('grok-4.1-fast-non-reasoning', 'grok-4.20-beta');

-- Nemotron 3 Super: streaming, system
UPDATE models SET capabilities = '["streaming", "system_message"]'::jsonb
WHERE id = 'nemotron-3-super';

-- GLM-5 via airforce: streaming, system
UPDATE models SET capabilities = '["streaming", "system_message"]'::jsonb
WHERE id = 'glm-5';

-- MiniMax M2.5: streaming, system
UPDATE models SET capabilities = '["streaming", "system_message"]'::jsonb
WHERE id = 'minimax-m2.5';

-- Mimo V2 Pro: streaming, system, vision (coding + vision model)
UPDATE models SET capabilities = '["streaming", "system_message", "vision"]'::jsonb
WHERE id = 'mimo-v2-pro';

-- ── Gemini-CLI models ──────────────────────────────────────────
-- Official Gemini API via geminicli2api, full feature support

-- Gemini 2.5 Pro: tool calling, vision, streaming, json_mode, system, pdf, reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message", "pdf_input", "reasoning"]'::jsonb
WHERE id = 'gemini-2.5-pro';

-- Gemini 2.5 Pro (No Thinking): same minus reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message", "pdf_input"]'::jsonb
WHERE id = 'gemini-2.5-pro-nothinking';

-- Gemini 2.5 Pro (Search): adds web_search
UPDATE models SET capabilities = '["tool_calling", "vision", "web_search", "streaming", "json_mode", "system_message", "pdf_input", "reasoning"]'::jsonb
WHERE id = 'gemini-2.5-pro-search';

-- Gemini 2.5 Flash: tool calling, vision, streaming, json_mode, system, reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message", "reasoning"]'::jsonb
WHERE id = 'gemini-2.5-flash';

-- Gemini 2.5 Flash (No Thinking): same minus reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id = 'gemini-2.5-flash-nothinking';

-- Gemini 3.0 Flash Preview: tool calling, vision, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id = 'gemini-3-flash-preview';

-- Gemini 3.1 Pro Preview: tool calling, vision, streaming, json_mode, system, pdf, reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message", "pdf_input", "reasoning"]'::jsonb
WHERE id = 'gemini-3.1-pro-preview';

-- Gemini 3.1 Flash Preview: tool calling, vision, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id = 'gemini-3.1-flash-preview';

-- ── Antigravity models (an/) ───────────────────────────────────
-- Premium Claude + Gemini via Google Antigravity accounts

-- Claude Sonnet 4.5: tool calling, vision, streaming, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
WHERE id = 'an/claude-sonnet-4-5';

-- Claude Sonnet 4.5 Thinking: + reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input", "reasoning"]'::jsonb
WHERE id = 'an/claude-sonnet-4-5-thinking';

-- Claude Opus 4.5 Thinking: + reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input", "reasoning"]'::jsonb
WHERE id = 'an/claude-opus-4-5-thinking';

-- Claude Opus 4.6: tool calling, vision, streaming, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
WHERE id = 'an/claude-opus-4-6';

-- Claude Opus 4.6 Thinking: + reasoning
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input", "reasoning"]'::jsonb
WHERE id = 'an/claude-opus-4-6-thinking';

-- Gemini 3 Pro High/Low: tool calling, vision, streaming, json_mode, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message", "pdf_input"]'::jsonb
WHERE id IN ('an/gemini-3-pro-high', 'an/gemini-3-pro-low');

-- Gemini 3 Flash: tool calling, vision, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id = 'an/gemini-3-flash';

-- ── TrollLLM models (t/) ──────────────────────────────────────
-- Premium pay-per-token reseller

-- Claude Sonnet 4/4.5/4.6: tool calling, vision, streaming, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
WHERE id IN ('t/claude-sonnet-4', 't/claude-sonnet-4.5', 't/claude-sonnet-4.6');

-- Claude Opus 4.5/4.6: tool calling, vision, streaming, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message", "pdf_input"]'::jsonb
WHERE id IN ('t/claude-opus-4.5', 't/claude-opus-4.6');

-- Claude Haiku 4.5: tool calling, vision, streaming, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "system_message"]'::jsonb
WHERE id = 't/claude-haiku-4.5';

-- GPT-5.2 / 5.2 Codex / 5.3 Codex / 5.4: tool calling, vision, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id IN ('t/gpt-5.2', 't/gpt-5.2-codex', 't/gpt-5.3-codex', 't/gpt-5.4');

-- Gemini 3.1 Pro: tool calling, vision, streaming, json_mode, system, pdf
UPDATE models SET capabilities = '["tool_calling", "vision", "streaming", "json_mode", "system_message", "pdf_input"]'::jsonb
WHERE id = 't/gemini-3.1-pro';

-- ── Nano models (na/) ─────────────────────────────────────────
-- Free-tier models via NanoGPT

-- Kimi K2.5 / K2.5 Thinking: tool calling, streaming, system
UPDATE models SET capabilities = '["tool_calling", "streaming", "system_message"]'::jsonb
WHERE id IN ('na/kimi-k2.5', 'na/kimi-k2.5-thinking');

-- GLM 4.7 / 5: streaming, system
UPDATE models SET capabilities = '["streaming", "system_message"]'::jsonb
WHERE id IN ('na/glm-4.7', 'na/glm-5');

-- DeepSeek V3 0324: tool calling, streaming, json_mode, system
UPDATE models SET capabilities = '["tool_calling", "streaming", "json_mode", "system_message"]'::jsonb
WHERE id = 'na/deepseek-v3-0324';

-- DeepSeek R1 0528: streaming, system, reasoning
UPDATE models SET capabilities = '["streaming", "system_message", "reasoning"]'::jsonb
WHERE id = 'na/deepseek-r1-0528';

-- ── Webproxy model (w/) ───────────────────────────────────────
-- Gemini via Playwright web subscription proxy

-- Gemini 3 Pro (Web): tool calling, vision, streaming, json_mode, system, pdf, web_search
UPDATE models SET capabilities = '["tool_calling", "vision", "web_search", "streaming", "json_mode", "system_message", "pdf_input"]'::jsonb
WHERE id = 'w/gemini';

-- 3. Add a GIN index for efficient JSONB containment queries (e.g. capabilities @> '["vision"]')
CREATE INDEX IF NOT EXISTS idx_models_capabilities ON models USING gin (capabilities);
