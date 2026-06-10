-- ============================================================================
-- Roll for Rating — Trust & Safety (App Store Guideline 1.2 for UGC)
-- Run in the Supabase SQL editor (after schema.sql). Safe to re-run.
--
-- Adds the pieces Apple requires for an app with user-generated content:
--   • block abusive users (blocked_users) + hide them + stop interaction
--   • report users / content (user_reports) into a moderation queue
--   • record EULA/terms acceptance (profiles.terms_accepted_at)
-- ============================================================================

-- ---- Blocking --------------------------------------------------------------
create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
alter table public.blocked_users enable row level security;
drop policy if exists "blocks_select_own" on public.blocked_users;
create policy "blocks_select_own" on public.blocked_users for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "blocks_insert_own" on public.blocked_users;
create policy "blocks_insert_own" on public.blocked_users for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists "blocks_delete_own" on public.blocked_users;
create policy "blocks_delete_own" on public.blocked_users for delete to authenticated using (blocker_id = auth.uid());

-- True if a block exists in EITHER direction (used to stop all interaction).
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- All user ids the caller has blocked OR who have blocked the caller — so the
-- client can hide them from search, the Roll Finder, leaderboards, etc.
-- (SECURITY DEFINER so it can see the "blocked me" side the caller can't read.)
create or replace function public.my_blocked_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select blocked_id from public.blocked_users where blocker_id = auth.uid()
  union
  select blocker_id from public.blocked_users where blocked_id = auth.uid();
$$;

-- Defense-in-depth: never create a match between blocked users.
create or replace function public.enforce_not_blocked()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_pair(new.challenger_id, new.opponent_id) then
    raise exception 'You can''t start a match with a user you''ve blocked (or who blocked you).';
  end if;
  return new;
end; $$;
drop trigger if exists trg_not_blocked on public.matches;
create trigger trg_not_blocked before insert on public.matches
  for each row execute function public.enforce_not_blocked();

-- ---- Reporting -------------------------------------------------------------
create table if not exists public.user_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  match_id         uuid references public.matches(id) on delete set null,
  reason           text not null,
  details          text,
  status           text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at       timestamptz not null default now()
);
alter table public.user_reports enable row level security;
-- Anyone signed in can file a report (about themselves as reporter); they can
-- see their own. Moderators review via the service role / dashboard.
drop policy if exists "reports_insert_own" on public.user_reports;
create policy "reports_insert_own" on public.user_reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "reports_select_own" on public.user_reports;
create policy "reports_select_own" on public.user_reports for select to authenticated using (reporter_id = auth.uid());

create index if not exists idx_reports_open on public.user_reports (status, created_at) where status = 'open';

-- ---- EULA / terms acceptance ----------------------------------------------
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
grant update (terms_accepted_at) on public.profiles to authenticated;
