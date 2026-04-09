-- ============================================================
-- Antigravity provider (an/ prefix)
-- Routes through anti-api which manages Google Antigravity accounts.
-- Treated as premium requests (same as gm/).
-- ============================================================

INSERT INTO models (id, provider, upstream_model_id, display_name, cost_per_m_input, cost_per_m_output, margin, is_active)
VALUES
  ('an/claude-sonnet-4-5',          'antigravity', 'claude-sonnet-4-5',          'Claude Sonnet 4.5',          1.50, 1.50, 1.55, true),
  ('an/claude-sonnet-4-5-thinking', 'antigravity', 'claude-sonnet-4-5-thinking', 'Claude Sonnet 4.5 Thinking', 1.50, 1.50, 1.55, true),
  ('an/claude-opus-4-5-thinking',   'antigravity', 'claude-opus-4-5-thinking',   'Claude Opus 4.5 Thinking',   3.00, 3.00, 1.55, true),
  ('an/claude-opus-4-6',            'antigravity', 'claude-opus-4-6',            'Claude Opus 4.6',            3.00, 3.00, 1.55, true),
  ('an/claude-opus-4-6-thinking',   'antigravity', 'claude-opus-4-6-thinking',   'Claude Opus 4.6 Thinking',   3.00, 3.00, 1.55, true),
  ('an/gemini-3-pro-high',          'antigravity', 'gemini-3-pro-high',          'Gemini 3 Pro (High)',        2.20, 2.20, 1.55, true),
  ('an/gemini-3-pro-low',           'antigravity', 'gemini-3-pro-low',           'Gemini 3 Pro (Low)',         1.00, 1.00, 1.55, true),
  ('an/gemini-3-flash',             'antigravity', 'gemini-3-flash',             'Gemini 3 Flash',             0.50, 0.50, 1.55, true)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  upstream_model_id = EXCLUDED.upstream_model_id,
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active;
