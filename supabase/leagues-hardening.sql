-- ============================================================================
-- Roll for Rating - LEAGUES SECURITY HARDENING (2026-07-18, post-audit)
-- Run in the Supabase SQL editor AFTER leagues.sql, league-invites.sql,
-- league-divisions.sql, league-teams.sql, league-team-fixtures.sql,
-- league-team-subbouts.sql, league-team-playoff.sql. Safe to re-run.
--
-- IMPORTANT: this file DELIBERATELY lives apart from leagues.sql because
-- re-running leagues.sql would revert _settle_match to its historical body (see
-- the warning at the top of leagues.sql). This file only touches RLS policies,
-- grants, triggers, and is_league_organizer - never the settlement engine.
--
-- Closes the audit HIGH/MEDIUM access-control findings:
--   * league_members: any user could self-join ANY league with ANY role
--     (self-promote to organizer, join private leagues, retro-pair).
--   * leagues: `using(true)` exposed private leagues + join_code to everyone.
--   * matches.league_id was client-settable to any league with no membership
--     check (standings farming + rating-inert match tagging).
--   * league_fixtures update let a participant rewrite any column.
--   * is_league_organizer had two divergent bodies (load-order dependent).
--   * the team read-only *_list RPCs were anon-callable (PII oracle).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- is_league_organizer - SINGLE canonical body: the league creator, OR a member
-- explicitly promoted to role='organizer'. This is SAFE now only because the
-- league_members policies below forbid self-promotion. This body is byte-
-- identical to league-invites.sql; league-divisions.sql no longer redefines it.
-- ---------------------------------------------------------------------------
create or replace function public.is_league_organizer(p_lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leagues l where l.id = p_lid and l.created_by = auth.uid())
      or exists (select 1 from public.league_members m
                 where m.league_id = p_lid and m.user_id = auth.uid() and m.role = 'organizer');
$$;
grant execute on function public.is_league_organizer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- leagues: private leagues (and every league's join_code) must NOT be world-
-- readable. Open leagues stay public; private leagues are visible only to the
-- creator, current members, and anyone holding a pending invite.
-- ---------------------------------------------------------------------------
drop policy if exists "leagues_read" on public.leagues;
create policy "leagues_read" on public.leagues for select to authenticated
  using (
    visibility = 'open'
    or created_by = auth.uid()
    or exists (select 1 from public.league_members m where m.league_id = id and m.user_id = auth.uid())
    or exists (select 1 from public.league_invites li
               where li.league_id = id and li.invited_user = auth.uid() and li.status = 'pending')
  );

-- ---------------------------------------------------------------------------
-- league_members: lock down direct client writes.
--   INSERT: self-join is allowed only as role='member' into an OPEN league
--           (private leagues must go through join_league_by_code /
--           respond_league_invite, which are SECURITY DEFINER); the league
--           creator may insert any row for their own league (this covers the
--           create-league organizer bootstrap in src/lib/leagues.ts).
--   UPDATE: a member may edit only their OWN row and may NOT change role
--           (no self-promotion); the creator may change any row.
-- ---------------------------------------------------------------------------
drop policy if exists "league_members_join" on public.league_members;
create policy "league_members_join" on public.league_members for insert to authenticated
  with check (
    (user_id = auth.uid() and role = 'member'
      and exists (select 1 from public.leagues l where l.id = league_id and l.visibility = 'open'))
    or exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid())
  );

drop policy if exists "league_members_update" on public.league_members;
create policy "league_members_update" on public.league_members for update to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid())
  )
  with check (
    (user_id = auth.uid() and role = 'member')
    or exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid())
  );
-- (league_members_leave / _read are unchanged; self-delete + open read are fine.)

-- ---------------------------------------------------------------------------
-- league_fixtures: a participant may link only the match they played. Restrict
-- the client UPDATE to the match_id column (the RLS USING policy still limits it
-- to the two competitors); every other column is written by SECURITY DEFINER
-- functions (owner-run, unaffected by these grants).
-- ---------------------------------------------------------------------------
revoke update on public.league_fixtures from authenticated;
grant update (match_id) on public.league_fixtures to authenticated;

-- ---------------------------------------------------------------------------
-- matches.league_id gate: a client may tag a match with a league_id only if
-- BOTH competitors are active members of that league. Blocks standings farming
-- against arbitrary leagues and rating-inert tagging of leagues you never joined.
-- Non-league matches (league_id null) and tournament matches are unaffected.
-- ---------------------------------------------------------------------------
create or replace function public._enforce_league_match_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.league_id is not null then
    if not exists (select 1 from public.league_members m
                   where m.league_id = new.league_id and m.user_id = new.challenger_id and m.active) then
      raise exception 'You must be an active member of that league to log a league match';
    end if;
    if new.opponent_id is not null and not exists (
        select 1 from public.league_members m
        where m.league_id = new.league_id and m.user_id = new.opponent_id and m.active) then
      raise exception 'Both competitors must be active members of that league';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_league_match_membership on public.matches;
create trigger trg_league_match_membership
  before insert on public.matches
  for each row execute function public._enforce_league_match_membership();

-- ---------------------------------------------------------------------------
-- leagues shape lock: once teams exist, the team format is frozen - flipping
-- team_rule/team_size mid-season corrupts live fixtures and standings. Name,
-- description, meet day/time, and location stay editable.
-- ---------------------------------------------------------------------------
create or replace function public._lock_league_shape()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.team_rule is distinct from old.team_rule or new.team_size is distinct from old.team_size)
     and exists (select 1 from public.league_teams t where t.league_id = old.id) then
    raise exception 'Cannot change the team format after teams exist';
  end if;
  return new;
end; $$;

drop trigger if exists trg_lock_league_shape on public.leagues;
create trigger trg_lock_league_shape
  before update on public.leagues
  for each row execute function public._lock_league_shape();

-- ---------------------------------------------------------------------------
-- Team read-only list RPCs are SECURITY DEFINER and return profile PII
-- (display_name, belt_rank of rostered members). Supabase grants EXECUTE to
-- PUBLIC (hence anon) by default, so revoke it - they stay authenticated-only.
-- ---------------------------------------------------------------------------
revoke execute on function public.league_teams_list(uuid) from public, anon;
revoke execute on function public.league_team_fixtures_list(uuid, int) from public, anon;
revoke execute on function public.league_team_standings(uuid) from public, anon;
revoke execute on function public.league_team_subbouts_list(uuid) from public, anon;
revoke execute on function public.league_team_playoff_list(uuid) from public, anon;

notify pgrst, 'reload schema';
select 'leagues security hardening installed' as ok;
