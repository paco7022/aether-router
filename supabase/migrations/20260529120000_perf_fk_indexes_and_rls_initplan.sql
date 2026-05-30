-- Performance migration (2026-05-29)
-- Applied to remote via Supabase MCP; this file mirrors it for repo history.
-- All statements are idempotent (IF NOT EXISTS / in-place ALTER POLICY).
--
-- 1) Covering indexes for foreign keys on small/low-write tables.
--    Deliberately skips usage_logs.api_key_id: usage_logs is the hottest
--    insert table and an extra index there adds WAL per insert for an FK
--    path that is almost never exercised (api_key deletes are rare).
create index if not exists idx_profiles_plan_id on public.profiles (plan_id);
create index if not exists idx_subscriptions_plan_id on public.subscriptions (plan_id);
create index if not exists idx_chat_conversations_model_id on public.chat_conversations (model_id);
create index if not exists idx_free_event_user_counters_user_id on public.free_event_user_counters (user_id);

-- 2) Fix auth_rls_initplan: wrap auth.*() in a scalar subquery so the planner
--    evaluates them once per statement instead of once per row.

-- api_keys
alter policy "Users can delete own keys" on public.api_keys using ((select auth.uid()) = user_id);
alter policy "Users can insert own keys" on public.api_keys with check ((select auth.uid()) = user_id);
alter policy "Users can update own keys" on public.api_keys using ((select auth.uid()) = user_id);
alter policy "Users can view own keys"   on public.api_keys using ((select auth.uid()) = user_id);

-- chat_conversations
alter policy "Users delete own conversations" on public.chat_conversations using ((select auth.uid()) = user_id);
alter policy "Users insert own conversations" on public.chat_conversations with check ((select auth.uid()) = user_id);
alter policy "Users update own conversations" on public.chat_conversations using ((select auth.uid()) = user_id);
alter policy "Users view own conversations"   on public.chat_conversations using ((select auth.uid()) = user_id);

-- chat_messages
alter policy "Users delete own messages" on public.chat_messages using ((select auth.uid()) = user_id);
alter policy "Users insert own messages" on public.chat_messages with check ((select auth.uid()) = user_id);
alter policy "Users view own messages"   on public.chat_messages using ((select auth.uid()) = user_id);

-- profiles
alter policy "Users can update own profile" on public.profiles using ((select auth.uid()) = id);
alter policy "Users can view own profile"   on public.profiles using ((select auth.uid()) = id);

-- referrals
alter policy "Users can view their own referrals" on public.referrals
  using (((select auth.uid()) = referrer_id) or ((select auth.uid()) = referee_id));

-- subscriptions / transactions / usage_logs (SELECT own)
alter policy "Users can view own subscriptions" on public.subscriptions using ((select auth.uid()) = user_id);
alter policy "Users can view own transactions"  on public.transactions  using ((select auth.uid()) = user_id);
alter policy "Users can view own usage"         on public.usage_logs    using ((select auth.uid()) = user_id);

-- service_role-only tables (auth.role() -> scalar subquery)
alter policy "Service role only" on public.banned_fingerprints using ((select auth.role()) = 'service_role');
alter policy "Service role only" on public.device_fingerprints using ((select auth.role()) = 'service_role');
alter policy "service_role_only" on public.daily_token_pools using ((select auth.role()) = 'service_role');
alter policy "service_role_only" on public.daily_user_token_pools using ((select auth.role()) = 'service_role');
alter policy "service_role_only" on public.free_events using ((select auth.role()) = 'service_role');
alter policy "service_role_only" on public.lightningzeus_daily_pool using ((select auth.role()) = 'service_role');
alter policy "service_role_only" on public.stripe_webhook_events using ((select auth.role()) = 'service_role');
