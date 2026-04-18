-- ============================================================
-- Chat feature — in-dashboard ChatGPT-style chat
--
-- Fase 1 (MVP):
--   - chat_conversations: one row per conversation
--   - chat_messages: one row per message (role + content)
--   - RLS: a user only sees/edits/deletes their own rows
--   - usage_logs.api_key_id made nullable so internal chat requests
--     (session-authed, no API key) can still be logged/billed via the
--     normal usage_logs pipeline; a `source` column distinguishes them.
--
-- Fase 2 will migrate chat_messages.content from TEXT to JSONB so we can
-- store multimodal parts (text + image_url). The column is already JSONB
-- to avoid a second migration.
-- ============================================================

-- 1. chat_conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New chat',
  model_id   TEXT NOT NULL REFERENCES models(id),
  system_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_user_updated
  ON chat_conversations(user_id, updated_at DESC);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own conversations"
  ON chat_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own conversations"
  ON chat_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own conversations"
  ON chat_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own conversations"
  ON chat_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- 2. chat_messages
-- `content` is JSONB so Fase 2 can store multimodal parts without a schema
-- change. For text-only messages we store { "type": "text", "text": "..." }
-- or a plain string — the client/server normalizes both.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         JSONB NOT NULL,
  model_id        TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  credits_charged   BIGINT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv_created
  ON chat_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chat_msg_user
  ON chat_messages(user_id);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own messages"
  ON chat_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own messages"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own messages"
  ON chat_messages FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Keep conversations.updated_at fresh when messages are added.
CREATE OR REPLACE FUNCTION touch_chat_conversation()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_chat_messages_touch ON chat_messages;
CREATE TRIGGER trg_chat_messages_touch
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION touch_chat_conversation();

-- 4. Allow internal (session-authed) requests to be logged without an API key.
-- `source` lets analytics split API traffic from in-dashboard chat.
ALTER TABLE usage_logs
  ALTER COLUMN api_key_id DROP NOT NULL;

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api'
    CHECK (source IN ('api', 'chat'));

CREATE INDEX IF NOT EXISTS idx_usage_source ON usage_logs(source, created_at DESC);
