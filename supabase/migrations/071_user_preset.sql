ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preset         JSONB,
  ADD COLUMN IF NOT EXISTS preset_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.preset IS
  'User preset JSONB (sampling params, prompts list, prefill, etc.). NULL = no preset.';
COMMENT ON COLUMN profiles.preset_enabled IS
  'When TRUE, the preset overrides/augments forwarded chat completion requests.';

-- Migrate existing system_injection text into preset format so users don't lose config.
UPDATE profiles
SET preset = jsonb_build_object(
  'version', 1,
  'name', 'Migrated injection',
  'sampling', '{}'::jsonb,
  'prompts', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', 'Legacy Injection',
    'role', 'system',
    'content', system_injection,
    'enabled', true
  )),
  'assistant_prefill', '',
  'prefill_enabled', false,
  'squash_system_messages', false
),
preset_enabled = system_injection_enabled
WHERE system_injection IS NOT NULL AND preset IS NULL;
