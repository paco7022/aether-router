-- ============================================================
-- Webproxy provider (w/ prefix) — PRIVATE BETA
-- Routes through a personal FastAPI proxy that drives Gemini web
-- subscriptions via Playwright. Treated as a premium request.
-- Access is gated in application code: only custom API keys may use it
-- until the beta gate is lifted in route.ts.
-- ============================================================

INSERT INTO models (id, provider, upstream_model_id, display_name, cost_per_m_input, cost_per_m_output, margin, is_active)
VALUES
  ('w/gemini', 'webproxy', 'gemini-3-pro', 'Gemini 3 Pro (Web)', 2.20, 2.20, 1.55, true)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  upstream_model_id = EXCLUDED.upstream_model_id,
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active;
