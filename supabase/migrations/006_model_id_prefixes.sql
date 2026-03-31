-- ============================================================
-- Add provider prefixes to model IDs (a/ = airforce, g/ = gemini-cli)
-- Add upstream_model_id to track the real model name sent to providers
-- ============================================================

-- Add upstream_model_id column (the real name the provider expects)
ALTER TABLE models ADD COLUMN upstream_model_id TEXT;

-- Set upstream_model_id to current id (before renaming)
UPDATE models SET upstream_model_id = id;

-- Make it NOT NULL after backfill
ALTER TABLE models ALTER COLUMN upstream_model_id SET NOT NULL;

-- Rename airforce models: id → a/...
UPDATE models SET id = 'a/' || id WHERE provider = 'airforce';

-- Rename gemini-cli models: id → g/...
UPDATE models SET id = 'g/' || id WHERE provider = 'gemini-cli';

-- Update usage_logs references (model_id is just text, not FK, but keep data consistent)
UPDATE usage_logs SET model_id = 'a/' || model_id
  WHERE model_id IN (SELECT upstream_model_id FROM models WHERE provider = 'airforce');

UPDATE usage_logs SET model_id = 'g/' || model_id
  WHERE model_id IN (SELECT upstream_model_id FROM models WHERE provider = 'gemini-cli');
