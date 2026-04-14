-- ============================================================
-- Remove Gameron provider (gm/)
-- Gameron is no longer supported. This migration removes the gm/
-- models from the catalog. Historical usage_logs rows with
-- model_id like 'gm/%' are preserved for accounting history.
--
-- w/gemini (webproxy) now fills the premium slot that gm/ used to.
-- It uses the default premium_request_cost = 1 (set in 016).
-- ============================================================

DELETE FROM models
WHERE provider = 'gameron';
