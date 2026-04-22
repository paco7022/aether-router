-- ============================================================
-- Anti-abuse follow-up: advisor fixes (2026-04-22)
--
-- Supabase advisor flagged two issues in the prior migration:
--   - blocked_email_domains is in public schema but had RLS disabled.
--   - The three new functions had a mutable search_path.
-- Both are low-risk on their own but close avenues for privilege
-- escalation via search_path shadowing, so pin them down.
-- ============================================================

-- Lock down the blocked-domains list behind RLS. No policies are added,
-- which means deny-all to anon/authenticated; service_role bypasses RLS.
ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY;

-- Pin search_path on the anti-abuse trigger functions.
ALTER FUNCTION public.block_abusive_signups()     SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_device_bans()       SET search_path = public, auth, pg_temp;
ALTER FUNCTION public.enforce_referral_limits()   SET search_path = public, pg_temp;
