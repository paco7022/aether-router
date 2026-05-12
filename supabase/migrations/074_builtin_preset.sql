ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS builtin_preset_id TEXT;

COMMENT ON COLUMN profiles.builtin_preset_id IS
  'When non-NULL and preset_enabled is TRUE, the server-side built-in preset with this id is applied to chat/completions requests instead of the user-managed JSONB preset. Built-in prompt content is private and never exposed to the client.';
