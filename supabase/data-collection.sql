-- ============================================================================
-- Roll for Rating — First-party data collection (product analytics + support)
-- Run in the Supabase SQL editor (after schema.sql). Safe to re-run.
--
-- These are FIRST-PARTY tables in our own Supabase — no third-party analytics
-- vendor, so the data stays with us and there's no cross-app tracking (no Apple
-- App Tracking Transparency prompt required). Crash/performance data is handled
-- separately by Sentry in the client.
--
-- Privacy-label mapping (App Store Connect):
--   analytics_events  -> "Product Interaction" / "Usage Data"
--   support_requests  -> "Customer Support"
-- All "linked to the user, used for App Functionality, not for tracking".
-- ============================================================================

-- ---- Product analytics -----------------------------------------------------
create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  session_id  text,
  platform    text,                    -- 'ios' | 'android' | 'web'
  app_version text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_event_time
  on public.analytics_events (event, created_at desc);
create index if not exists idx_analytics_user_time
  on public.analytics_events (user_id, created_at desc);

alter table public.analytics_events enable row level security;

-- Clients may only WRITE events attributed to themselves (or anonymous, pre-login
-- with a null user_id). They can never read the analytics stream — that's for the
-- team via the service role / dashboard.
drop policy if exists "analytics_insert_self" on public.analytics_events;
create policy "analytics_insert_self" on public.analytics_events
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

-- ---- In-app customer support ----------------------------------------------
create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  email       text,                    -- reply-to (defaults to account email)
  category    text not null default 'general'
                check (category in ('general','bug','account','billing','safety','feature')),
  subject     text,
  body        text not null,
  app_version text,
  platform    text,
  status      text not null default 'open'
                check (status in ('open','in_progress','resolved','closed')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_support_open
  on public.support_requests (status, created_at) where status = 'open';

alter table public.support_requests enable row level security;

-- A signed-in user can file a ticket (as themselves) and read their own tickets.
-- Support staff work the queue via the service role / dashboard.
drop policy if exists "support_insert_own" on public.support_requests;
create policy "support_insert_own" on public.support_requests
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "support_select_own" on public.support_requests;
create policy "support_select_own" on public.support_requests
  for select to authenticated using (user_id = auth.uid());
