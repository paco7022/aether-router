-- ============================================================
-- Birthday event auto-revert job (2026-04-22)
--
-- Runs every minute via pg_cron. For each row in model_cost_backup
-- whose associated free_events window has ended (or that is older
-- than ~12h and has no active matching event), restore the original
-- `premium_request_cost` and mark the backup row reverted. Also
-- flips any expired free_events rows to is_active = false.
--
-- Designed to be generic so future time-boxed events that use the
-- same free_events + model_cost_backup pattern are auto-cleaned.
-- ============================================================

CREATE OR REPLACE FUNCTION public.revert_expired_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT mcb.id AS backup_id, mcb.model_id, mcb.original_cost, mcb.event_name
    FROM public.model_cost_backup mcb
    WHERE mcb.reverted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.free_events fe
        WHERE fe.created_by IS NOT NULL
          AND fe.name LIKE '%' || replace(mcb.event_name, 'birthday_', 'Birthday ') || '%'
          AND fe.ends_at > NOW()
      )
      AND mcb.created_at < NOW() - INTERVAL '11 hours 50 minutes'
  LOOP
    UPDATE public.models
       SET premium_request_cost = r.original_cost
     WHERE id = r.model_id;

    UPDATE public.model_cost_backup
       SET reverted_at = NOW()
     WHERE id = r.backup_id;
  END LOOP;

  UPDATE public.free_events
     SET is_active = false
   WHERE is_active = true
     AND ends_at < NOW();
END;
$$;

-- Schedule once. The cron job name is idempotent: re-running this
-- migration on a DB where the job already exists will ignore the
-- duplicate via the cron.schedule conflict behaviour.
SELECT cron.schedule(
  'revert_expired_events',
  '* * * * *',
  $$SELECT public.revert_expired_events();$$
);
