-- Persist a model's reasoning / chain-of-thought alongside the assistant
-- message so it survives reloads. The dashboard chat surfaces it as a
-- collapsible block. Populated from the upstream `reasoning_content` SSE delta
-- (DeepSeek/OpenAI-compat convention; orbit maps Anthropic thinking blocks to
-- the same field). Inline <think>...</think> reasoning stays in `content` and
-- is split out client-side.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reasoning text;
