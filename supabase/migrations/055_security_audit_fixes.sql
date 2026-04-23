-- ============================================================
-- 055_security_audit_fixes
--
-- Fixes from comprehensive security audit (April 2026):
--
-- 1. REVOKE execute on add_credits/deduct_credits from public/anon/authenticated
--    (CRITICAL: any authenticated user could call add_credits to grant themselves unlimited credits)
--
-- 2. Enable RLS on device_fingerprints and banned_fingerprints
--    (CRITICAL: any authenticated user could read/modify ban records)
--
-- 3. Fix search_path on early SECURITY DEFINER functions
--
-- 4. Explicit REVOKE writes on models, usage_logs, transactions tables
-- ============================================================

-- ── 1. Lock down credit manipulation functions ──────────────
REVOKE EXECUTE ON FUNCTION public.add_credits(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.add_credits(UUID, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.deduct_credits(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deduct_credits(UUID, BIGINT) TO service_role;

-- ── 2. RLS on device_fingerprints and banned_fingerprints ───
ALTER TABLE IF EXISTS public.device_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.banned_fingerprints ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon/authenticated (service_role bypasses RLS).
-- Drop any existing permissive policies first to avoid conflicts.
DROP POLICY IF EXISTS "device_fingerprints_service_only" ON public.device_fingerprints;
CREATE POLICY "device_fingerprints_service_only"
  ON public.device_fingerprints
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "banned_fingerprints_service_only" ON public.banned_fingerprints;
CREATE POLICY "banned_fingerprints_service_only"
  ON public.banned_fingerprints
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Fix search_path on early SECURITY DEFINER functions ──
ALTER FUNCTION public.deduct_credits(UUID, BIGINT) SET search_path = public;
ALTER FUNCTION public.add_credits(UUID, BIGINT) SET search_path = public;

-- ── 4. Explicit write revocations on sensitive tables ───────
REVOKE INSERT, UPDATE, DELETE ON TABLE public.models FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.usage_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transactions FROM anon, authenticated;
