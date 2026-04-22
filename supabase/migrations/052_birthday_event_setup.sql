-- ============================================================
-- Birthday event scaffolding (2026-04-22)
--
-- Adds the infrastructure needed to run time-boxed pricing events:
--   - pg_cron extension for scheduled jobs.
--   - model_cost_backup table to snapshot `premium_request_cost`
--     before a discount goes live so we can revert cleanly.
--
-- The actual event launch (discounts, user bonus credits) is an
-- admin/data operation rather than a schema change and is kept out
-- of the migration stream on purpose — see 053_birthday_event_auto_revert.sql
-- for the self-revert job that runs alongside any future event.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.model_cost_backup (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name    text NOT NULL,
  model_id      text NOT NULL,
  original_cost numeric NOT NULL,
  event_cost    numeric NOT NULL,
  created_at    timestamptz DEFAULT NOW(),
  reverted_at   timestamptz
);

ALTER TABLE public.model_cost_backup ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_model_cost_backup_event
  ON public.model_cost_backup (event_name, reverted_at);
