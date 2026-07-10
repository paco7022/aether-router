-- Kiro community pool: let any user (free included) contribute their own Kiro
-- account token to a shared pool. Global cap of KIRO_POOL_MAX_SLOTS active
-- accounts is enforced app-side. Third-party refresh tokens are NEVER stored
-- here — they live only as account files on the VPS gateway. This table holds
-- metadata only (a non-reversible token hash + contributor + status) so we can
-- dedupe, count slots, and auto-free a slot when an account dies.

create table if not exists public.kiro_pool_accounts (
  id                   uuid primary key default gen_random_uuid(),
  -- sha256(refreshToken)[:12] — identity without storing the secret.
  token_hash           text not null unique,
  -- who contributed it (nullable so a deleted user doesn't orphan-block a slot).
  contributor_user_id  uuid references auth.users(id) on delete set null,
  -- account file name on the VPS gateway (e.g. "account_pool_ab12cd34ef56.json").
  filename             text not null,
  status               text not null default 'active'
                         check (status in ('active', 'dead')),
  created_at           timestamptz not null default now(),
  died_at              timestamptz,
  last_health_at       timestamptz,
  dead_reason          text
);

-- Slot counting hits this constantly (count active) — index the status.
create index if not exists idx_kiro_pool_status on public.kiro_pool_accounts (status);
create index if not exists idx_kiro_pool_contributor
  on public.kiro_pool_accounts (contributor_user_id);

-- Admin/service-role only. RLS on with no public policies → the service-role
-- key (used by the contribute endpoint on the PC node) bypasses RLS; regular
-- users cannot read other people's contribution metadata.
alter table public.kiro_pool_accounts enable row level security;
