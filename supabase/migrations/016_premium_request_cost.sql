-- ============================================================
-- Add premium_request_cost to models and usage_logs
-- Claude models = 2 premium requests
-- Gemini Pro = 1 premium request
-- Gemini Flash = 0.5 premium requests
-- ============================================================

-- 1. Add premium_request_cost column to models (default 1)
ALTER TABLE models ADD COLUMN premium_request_cost NUMERIC(4,2) NOT NULL DEFAULT 1;

-- 2. Add premium_cost column to usage_logs (stores cost at request time)
ALTER TABLE usage_logs ADD COLUMN premium_cost NUMERIC(4,2) NOT NULL DEFAULT 0;

-- 3. Set costs for antigravity Claude models = 2
UPDATE models SET premium_request_cost = 2
WHERE provider = 'antigravity' AND upstream_model_id LIKE 'claude%';

-- 4. Set costs for antigravity Gemini Flash = 0.5
UPDATE models SET premium_request_cost = 0.5
WHERE provider = 'antigravity' AND upstream_model_id LIKE 'gemini%flash%';

-- 5. Gemini Pro models stay at default 1

-- 6. Set costs for gameron Claude models = 2
UPDATE models SET premium_request_cost = 2
WHERE provider = 'gameron' AND upstream_model_id LIKE 'claude%';

-- 7. Set costs for gameron Gemini Flash = 0.5
UPDATE models SET premium_request_cost = 0.5
WHERE provider = 'gameron' AND upstream_model_id LIKE 'gemini%flash%';

-- 8. Set costs for lightningzeus Claude models = 2
UPDATE models SET premium_request_cost = 2
WHERE provider = 'lightningzeus' AND upstream_model_id LIKE 'claude%';

-- 9. Non-premium providers (airforce, gemini-cli) = 0
UPDATE models SET premium_request_cost = 0
WHERE provider IN ('airforce', 'gemini-cli');

-- 10. Add Gemini 3.1 models (antigravity)
INSERT INTO models (id, provider, upstream_model_id, display_name, cost_per_m_input, cost_per_m_output, margin, is_active, premium_request_cost)
VALUES
  ('an/gemini-3.1-pro-preview',   'antigravity', 'gemini-3.1-pro-preview',   'Gemini 3.1 Pro (Preview)',   0, 0, 1.0, true, 1),
  ('an/gemini-3.1-flash-preview', 'antigravity', 'gemini-3.1-flash-preview', 'Gemini 3.1 Flash (Preview)', 0, 0, 1.0, true, 0.5)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  upstream_model_id = EXCLUDED.upstream_model_id,
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active,
  premium_request_cost = EXCLUDED.premium_request_cost;
