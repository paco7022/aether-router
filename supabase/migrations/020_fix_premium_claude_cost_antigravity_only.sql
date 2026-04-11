-- ============================================================
-- Fix: the x2 premium_request_cost for Claude models should
-- only apply to the antigravity (an/) provider.
--
-- Migration 016 accidentally set the same x2 cost on gameron
-- (gm/) and lightningzeus (c/) Claude models. Restore those
-- to the default cost of 1.
-- ============================================================

UPDATE models SET premium_request_cost = 1
WHERE provider = 'gameron' AND upstream_model_id LIKE 'claude%';

UPDATE models SET premium_request_cost = 1
WHERE provider = 'lightningzeus' AND upstream_model_id LIKE 'claude%';
