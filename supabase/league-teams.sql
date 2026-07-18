-- ============================================================================
-- Roll for Rating - LEAGUE TEAM FORMATS (Phase 1: formats + rosters)
-- Run in the Supabase SQL editor AFTER leagues.sql and league-divisions.sql.
-- Safe to re-run.
--
-- Leagues can now run as a TEAM competition, not just individual member-vs-
-- member. A league picks one format:
--   individuals  team_rule 'none'    team_size 1   (the legacy behavior)
--   2v2 dual     team_rule 'duel'    team_size 2
--   3v3 dual     team_rule 'duel'    team_size 3
--   quintet      team_rule 'quintet' team_size 5   (winner-stays survivor)
--
-- This file adds the format columns + team rosters (mirrors tournament_teams /
-- tournament_team_members) + organizer-gated CRUD. Weekly TEAM fixtures, team
-- scoring (dual / quintet sub-bouts) and the season-ending playoff are later
-- phases; a league with team_rule 'none' is completely unchanged.
-- ============================================================================

-- --- Format on the league ----------------------------------------------------
alter table public.leagues add column if not exists team_rule text not null default 'none';
do $$ begin
  alter table public.leagues add constraint leagues_team_rule_chk
    check (team_rule in ('none','duel','quintet'));
exception when duplicate_object then null; end $$;

alter table public.leagues add column if not exists team_size int not null default 1;
do $$ begin
  alter table public.leagues add constraint leagues_team_size_chk
    check (team_size in (1,2,3,5));
exception when duplicate_object then null; end $$;

-- --- Rosters -----------------------------------------------------------------
create table if not exists public.league_teams (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  name       text not null,
  captain_id uuid references public.profiles(id) on delete set null,
  seed       int,
  created_at timestamptz not null default now()
);

create table if not exists public.league_team_members (
  team_id uuid not null references public.league_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot    int,
  primary key (team_id, user_id)
);

create index if not exists idx_league_teams_league on public.league_teams (league_id);
create index if not exists idx_league_team_members_user on public.league_team_members (user_id);

alter table public.league_teams        enable row level security;
alter table public.league_team_members enable row level security;

drop policy if exists "league_teams_read" on public.league_teams;
create policy "league_teams_read" on public.league_teams for select to authenticated using (true);
drop policy if exists "league_team_members_read" on public.league_team_members;
create policy "league_team_members_read" on public.league_team_members for select to authenticated using (true);

-- --- CRUD (organizer-gated via is_league_organizer from league-divisions.sql) -
create or replace function public.create_league_team(p_league uuid, p_name text, p_captain uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not public.is_league_organizer(p_league) then raise exception 'Only the organizer can add teams'; end if;
  if coalesce((select team_rule from public.leagues where id = p_league), 'none') = 'none' then
    raise exception 'This league is individual - no teams';
  end if;
  insert into public.league_teams (league_id, name, captain_id)
  values (p_league, coalesce(nullif(btrim(p_name), ''), 'Team'), p_captain)
  returning id into tid;
  return tid;
end; $$;

create or replace function public.delete_league_team(p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select league_id into lid from public.league_teams where id = p_team;
  if lid is null then raise exception 'Team not found'; end if;
  if not public.is_league_organizer(lid) then raise exception 'Only the organizer can delete a team'; end if;
  -- A team's fixtures reference it ON DELETE CASCADE, so deleting a team once a
  -- season/playoff exists would silently erase played results + bracket nodes and
  -- rewrite everyone's standings. Refuse; the schedule must be cleared first.
  if exists (select 1 from public.league_team_fixtures f where f.team_a = p_team or f.team_b = p_team) then
    raise exception 'Cannot delete a team that already has fixtures; clear the season/playoff first';
  end if;
  delete from public.league_teams where id = p_team;
end; $$;

-- Add a member to a team (organizer only). Respects the league's team_size and
-- also enrolls them as an active league member (a rostered player is a member).
create or replace function public.add_league_team_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid; sz int; n int; wk int;
begin
  -- Lock the team row so concurrent adds serialize (the size cap + one-team-per-
  -- league checks below are otherwise TOCTOU).
  perform 1 from public.league_teams where id = p_team for update;
  select lt.league_id, l.team_size into lid, sz
  from public.league_teams lt join public.leagues l on l.id = lt.league_id
  where lt.id = p_team;
  if lid is null then raise exception 'Team not found'; end if;
  if not public.is_league_organizer(lid) then raise exception 'Only the organizer can add members'; end if;
  -- Freeze the roster while a matchup is being scored: the sub-bout engine indexes
  -- into a slot-ordered roster array rebuilt per call, so mutating it mid-matchup
  -- would skip a live fighter or record against the wrong athlete.
  if exists (
    select 1 from public.league_team_fixtures f
    where (f.team_a = p_team or f.team_b = p_team) and f.status = 'pending'
      and (f.a_idx > 1 or f.b_idx > 1
           or exists (select 1 from public.league_team_subbouts s where s.fixture_id = f.id))
  ) then
    raise exception 'Cannot change the roster while a matchup is being scored; finish or reset it first';
  end if;

  -- A player is on at most one team in a league (mirrors one-division-per-league).
  if exists (
    select 1 from public.league_team_members m
    join public.league_teams t on t.id = m.team_id
    where t.league_id = lid and m.user_id = p_user
  ) then
    raise exception 'That player is already on a team in this league';
  end if;

  select count(*) into n from public.league_team_members where team_id = p_team;
  if n >= sz then raise exception 'Team is full (% members)', sz; end if;

  -- slot = max+1 (not count+1) so a remove-then-add never reuses a slot number,
  -- which would corrupt Phase-2 positional sub-bout pairing.
  insert into public.league_team_members (team_id, user_id, slot)
  values (p_team, p_user, coalesce((select max(slot) from public.league_team_members where team_id = p_team), 0) + 1)
  on conflict do nothing;

  wk := public.current_league_week(lid);
  insert into public.league_members (league_id, user_id, role, joined_week)
  values (lid, p_user, 'member', wk)
  on conflict (league_id, user_id) do update set active = true;
end; $$;

create or replace function public.remove_league_team_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select league_id into lid from public.league_teams where id = p_team;
  if lid is null then raise exception 'Team not found'; end if;
  if not public.is_league_organizer(lid) then raise exception 'Only the organizer can remove members'; end if;
  -- Same roster freeze as add_league_team_member (see the note there).
  if exists (
    select 1 from public.league_team_fixtures f
    where (f.team_a = p_team or f.team_b = p_team) and f.status = 'pending'
      and (f.a_idx > 1 or f.b_idx > 1
           or exists (select 1 from public.league_team_subbouts s where s.fixture_id = f.id))
  ) then
    raise exception 'Cannot change the roster while a matchup is being scored; finish or reset it first';
  end if;
  delete from public.league_team_members where team_id = p_team and user_id = p_user;
end; $$;

-- Full team list + member rows for the organizer builder + anyone browsing.
create or replace function public.league_teams_list(p_league uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',         t.id,
      'name',       t.name,
      'captain_id', t.captain_id,
      'seed',       t.seed,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', p.id, 'display_name', p.display_name, 'belt_rank', p.belt_rank, 'slot', m.slot
        ) order by m.slot)
        from public.league_team_members m
        join public.profiles p on p.id = m.user_id
        where m.team_id = t.id
      ), '[]'::jsonb)
    ) order by t.created_at
  ), '[]'::jsonb)
  from public.league_teams t
  where t.league_id = p_league;
$$;

grant execute on function public.create_league_team(uuid, text, uuid) to authenticated;
grant execute on function public.delete_league_team(uuid) to authenticated;
grant execute on function public.add_league_team_member(uuid, uuid) to authenticated;
grant execute on function public.remove_league_team_member(uuid, uuid) to authenticated;
grant execute on function public.league_teams_list(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'league teams (phase 1) installed' as ok;
