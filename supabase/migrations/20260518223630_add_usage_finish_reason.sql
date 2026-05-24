-- Store the upstream/client terminal reason for chat completions.
-- The route already writes this field for both streaming and non-streaming
-- requests; without the column, usage logging fails on databases rebuilt
-- from migrations.
ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS finish_reason TEXT;

COMMENT ON COLUMN public.usage_logs.finish_reason IS
  'Terminal reason reported by the upstream model, or aborted when the client disconnected mid-stream.';
