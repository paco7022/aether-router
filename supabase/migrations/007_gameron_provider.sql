-- ============================================================
-- Add gameron provider models (temporary, for testing)
-- Prefix: gm/
-- ============================================================
INSERT INTO models (id, provider, upstream_model_id, display_name, cost_per_m_input, cost_per_m_output, margin) VALUES
  ('gm/claude-sonnet-4-6',       'gameron', 'claude-sonnet-4-6',       'Claude Sonnet 4.6',           1.50, 1.50, 1.55),
  ('gm/claude-haiku-4.5',        'gameron', 'claude-haiku-4.5',        'Claude Haiku 4.5',            0.50, 0.50, 1.55),
  ('gm/claude-opus-4-6',         'gameron', 'claude-opus-4-6',         'Claude Opus 4.6',             3.00, 3.00, 1.55),
  ('gm/gpt-5.3-codex',           'gameron', 'gpt-5.3-codex',           'GPT-5.3 Codex',              1.50, 1.50, 1.55),
  ('gm/gemini-3.1-pro-preview',  'gameron', 'gemini-3.1-pro-preview',  'Gemini 3.1 Pro Preview',      2.20, 2.20, 1.55),
  ('gm/gpt-5.4',                 'gameron', 'gpt-5.4',                 'GPT-5.4',                     1.50, 1.50, 1.55);
