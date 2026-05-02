-- System prompt injection per user.
--
-- When system_injection_enabled = TRUE the proxy prepends system_injection
-- to every chat/completions request before forwarding to the upstream
-- provider, regardless of the client (Janitor AI, SillyTavern, etc.).
-- The injection is always placed first — ahead of any system message the
-- client may send.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS system_injection         TEXT          NULL,
  ADD COLUMN IF NOT EXISTS system_injection_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.system_injection IS
  'Optional system prompt prepended to every API request for this user. NULL means no injection.';

COMMENT ON COLUMN profiles.system_injection_enabled IS
  'When TRUE, system_injection is prepended to all chat completion requests.';
