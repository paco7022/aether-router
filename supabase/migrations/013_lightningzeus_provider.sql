-- LightningZeus provider (c/ prefix)
-- Global pool of 3000 requests/day shared across all users.
-- Counts as premium (gm) request for plan-limit purposes.

-- 1. Add c/ models
INSERT INTO models (id, provider, upstream_model_id, display_name, cost_per_m_input, cost_per_m_output, margin, is_active)
VALUES
  ('c/claude-opus-4-6',            'lightningzeus', 'claude-opus-4.6',            'Claude Opus 4.6',            0, 0, 1.0, true),
  ('c/claude-sonnet-4-6',          'lightningzeus', 'claude-sonnet-4-6',          'Claude Sonnet 4.6',          0, 0, 1.0, true),
  ('c/gpt-5.3-codex-thinking-mid', 'lightningzeus', 'gpt-5.3-codex-thinking-mid', 'GPT-5.3 Codex Thinking Mid', 0, 0, 1.0, true)
ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, upstream_model_id = EXCLUDED.upstream_model_id, is_active = EXCLUDED.is_active;

-- 2. Global daily pool counter for lightningzeus
CREATE TABLE IF NOT EXISTS lightningzeus_daily_pool (
  pool_date  DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  used       INTEGER NOT NULL DEFAULT 0,
  pool_limit INTEGER NOT NULL DEFAULT 3000
);

ALTER TABLE lightningzeus_daily_pool ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write this table
CREATE POLICY "service_role_only" ON lightningzeus_daily_pool
  FOR ALL USING (auth.role() = 'service_role');
