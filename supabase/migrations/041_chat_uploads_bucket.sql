-- ============================================================
-- Storage bucket for chat image uploads (Fase 2 multimodal).
--
-- - Private bucket `chat-uploads`; clients never access it via public URL.
-- - Path convention: {user_id}/{conversation_id}/{uuid}.{ext}
-- - RLS on storage.objects restricts every operation to paths whose first
--   segment equals the caller's auth.uid(), so a user can never read,
--   upload to, or delete another user's files.
-- - The API route serves signed URLs (short TTL) when returning messages
--   to the client and inlines images as data URLs when forwarding to the
--   upstream model via /v1/chat/completions.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-uploads',
  'chat-uploads',
  false,
  20 * 1024 * 1024,  -- 20 MB per image
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies: each clause matches only objects whose top-level folder is the
-- caller's uid. `split_part(name, '/', 1)` extracts the first path segment.
DROP POLICY IF EXISTS "chat_uploads_select_own" ON storage.objects;
CREATE POLICY "chat_uploads_select_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-uploads'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

DROP POLICY IF EXISTS "chat_uploads_insert_own" ON storage.objects;
CREATE POLICY "chat_uploads_insert_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-uploads'
    AND auth.uid()::text = split_part(name, '/', 1)
  );

DROP POLICY IF EXISTS "chat_uploads_delete_own" ON storage.objects;
CREATE POLICY "chat_uploads_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-uploads'
    AND auth.uid()::text = split_part(name, '/', 1)
  );
