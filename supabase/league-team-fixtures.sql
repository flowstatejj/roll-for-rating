-- ============================================================================
-- Roll for Rating - LEAGUE TEAM FIXTURES (Phase 2: season schedule + standings)
-- Run in the Supabase SQL editor AFTER league-teams.sql. Safe to re-run.
--
-- A team-format league now has a SEASON: a double round-robin (every team plays
-- every other team twice, home + away) generated up front, one round per week.
-- The organizer records each team matchup's score and a team standings table
-- ranks by the league's win/draw/loss points.
--
-- Phase 2 records a team result as a direct team SCORE (organizer enters e.g.
-- 3-2). Phase 3 will replace that entry with member-vs-member dual / quintet
-- sub-bouts that COMPUTE the score. The season/playoff bracket column is present
-- now so Phase 4 (playoff) can reuse this table.
-- ============================================================================

create table if not exists public.league_team_fixtures (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues(id) on delete cascade,
  bracket         text not null default 'season' check (bracket in ('season','playoff')),
  week_no         int  not null,
  round_no        int,                       -- playoff round (Phase 4); null for season
  team_a          uuid references public.league_teams(id) on delete cascade,
  team_b          uuid references public.league_teams(id) on delete cascade,  -- null = bye
  a_score         int  not null default 0,
  b_score         int  not null default 0,
  winner          text check (winner in ('a','b','draw')),
  status          text not null default 'pending' check (status in ('pending','done','bye')),
  next_fixture_id uuid references public.league_team_fixtures(id) on delete set null,  -- Phase 4
  next_slot       text check (next_slot in ('a','b')),
  created_at      timestamptz not null default now(),
  unique (league_id, bracket, week_no, team_a)
);

create index if not exists idx_ltf_league_week on public.league_team_fixtures (league_id, week_no);
create index if not exists idx_ltf_team_a on public.league_team_fixtures (team_a) where team_a is not null;
create index if not exists idx_ltf_team_b on public.league_team_fixtures (team_b) where team_b is not null;

alter table public.league_team_fixtures enable row level security;
drop policy if exists "ltf_read" on public.league_team_fixtures;
create policy "ltf_read" on public.league_team_fixtures for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- generate_league_team_season - organizer builds the whole double round-robin.
-- Circle method: first leg rounds 1..(n-1); second leg rounds n..2(n-1) with
-- home/away swapped. Odd team count gets a rotating bye. Idempotent (returns if
-- a season already exists). One round == one week_no.
-- ---------------------------------------------------------------------------
create or replace function public.generate_league_team_season(p_league uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ids uuid[]; n int; rnds int; half int; leg int; r int; i int; wk int;
  rot uuid[]; a uuid; b uuid; ha uuid; hb uuid;
begin
  if not public.is_league_organizer(p_league) then raise exception 'Only the organizer can generate the season'; end if;
  -- Lock the league so a double-fire serializes and the second call returns
  -- 'already' cleanly rather than hitting a raw unique violation.
  perform 1 from public.leagues where id = p_league for update;
  if coalesce((select team_rule from public.leagues where id = p_league), 'none') = 'none' then
    raise exception 'This is an individual league';
  end if;
  if exists (select 1 from public.league_team_fixtures where league_id = p_league and bracket = 'season') then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;

  select array_agg(id order by created_at) into ids from public.league_teams where league_id = p_league;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'reason', 'need_2_teams'); end if;

  if n % 2 = 1 then ids := ids || array[null::uuid]; n := n + 1; end if;  -- rotating bye
  rnds := n - 1; half := n / 2;
  -- A double round-robin is 2*(n-1) weeks; the leagues.weeks CHECK caps at 52.
  if 2 * rnds > 52 then raise exception 'Too many teams for a double round-robin season (max 26)'; end if;

  for leg in 0..1 loop
    for r in 1..rnds loop
      wk := leg * rnds + r;
      -- circle method: position 1 fixed, rotate the rest by (r-1)
      rot := array[ids[1]];
      for i in 1..(n - 1) loop rot := rot || ids[2 + ((i - 1 + (r - 1)) % (n - 1))]; end loop;
      for i in 1..half loop
        a := rot[i]; b := rot[n + 1 - i];
        if leg = 1 then ha := b; hb := a; else ha := a; hb := b; end if;  -- swap home/away 2nd leg
        if ha is null or hb is null then
          insert into public.league_team_fixtures (league_id, bracket, week_no, team_a, team_b, status)
          values (p_league, 'season', wk, coalesce(ha, hb), null, 'bye');
        else
          insert into public.league_team_fixtures (league_id, bracket, week_no, team_a, team_b, status)
          values (p_league, 'season', wk, ha, hb, 'pending');
        end if;
      end loop;
    end loop;
  end loop;

  -- Reflect the real season length on the league.
  update public.leagues set weeks = greatest(1, least(52, 2 * rnds)) where id = p_league;

  return jsonb_build_object('ok', true, 'weeks', 2 * rnds, 'teams', (select count(*) from public.league_teams where league_id = p_league));
end; $$;

-- ---------------------------------------------------------------------------
-- record_league_team_result - organizer enters a team matchup's final score.
-- (Phase 3 will supersede this with sub-bout-derived scoring.) Winner is derived
-- from the score; a draw is allowed for season play (not for the playoff).
-- ---------------------------------------------------------------------------
create or replace function public.record_league_team_result(p_fixture uuid, p_a_score int, p_b_score int)
returns void language plpgsql security definer set search_path = public as $$
declare f public.league_team_fixtures; w text;
begin
  select * into f from public.league_team_fixtures where id = p_fixture for update;
  if not found then raise exception 'Fixture not found'; end if;
  if not public.is_league_organizer(f.league_id) then raise exception 'Only the organizer can record results'; end if;
  if f.status = 'bye' then raise exception 'A bye has no result'; end if;
  if f.team_a is null or f.team_b is null then raise exception 'Both teams are required'; end if;
  if p_a_score < 0 or p_b_score < 0 then raise exception 'Scores must be >= 0'; end if;

  w := case when p_a_score > p_b_score then 'a' when p_b_score > p_a_score then 'b' else 'draw' end;
  update public.league_team_fixtures
     set a_score = p_a_score, b_score = p_b_score, winner = w, status = 'done'
   where id = p_fixture;
end; $$;

-- ---------------------------------------------------------------------------
-- Fixtures for a week (or the whole season if p_week is null), with team names.
-- ---------------------------------------------------------------------------
create or replace function public.league_team_fixtures_list(p_league uuid, p_week int default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id, 'week_no', f.week_no, 'bracket', f.bracket,
      'team_a', f.team_a, 'team_b', f.team_b,
      'team_a_name', ta.name, 'team_b_name', tb.name,
      'a_score', f.a_score, 'b_score', f.b_score, 'winner', f.winner, 'status', f.status
    ) order by f.week_no, f.team_a, f.created_at
  ), '[]'::jsonb)
  from public.league_team_fixtures f
  left join public.league_teams ta on ta.id = f.team_a
  left join public.league_teams tb on tb.id = f.team_b
  where f.league_id = p_league
    and f.bracket = 'season'
    and (p_week is null or f.week_no = p_week);
$$;

-- ---------------------------------------------------------------------------
-- league_team_standings - W/D/L + points (league win/draw/loss scheme) from
-- completed SEASON team fixtures. Byes count as neither win nor loss.
-- ---------------------------------------------------------------------------
create or replace function public.league_team_standings(p_league uuid)
returns table (team_id uuid, name text, played int, wins int, losses int, draws int, points int)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.leagues where id = p_league),
  teams as (select id, name from public.league_teams where league_id = p_league),
  mt as (
    select * from public.league_team_fixtures
    where league_id = p_league and bracket = 'season' and status = 'done'
      and team_a is not null and team_b is not null
  ),
  per as (
    select team_a as tid,
      case when winner = 'a' then 1 else 0 end as win,
      case when winner = 'b' then 1 else 0 end as loss,
      case when winner = 'draw' then 1 else 0 end as draw
    from mt
    union all
    select team_b as tid,
      case when winner = 'b' then 1 else 0 end as win,
      case when winner = 'a' then 1 else 0 end as loss,
      case when winner = 'draw' then 1 else 0 end as draw
    from mt
  )
  select
    teams.id, teams.name,
    coalesce(sum(coalesce(per.win,0)+coalesce(per.loss,0)+coalesce(per.draw,0)),0)::int as played,
    coalesce(sum(per.win),0)::int  as wins,
    coalesce(sum(per.loss),0)::int as losses,
    coalesce(sum(per.draw),0)::int as draws,
    coalesce(sum(coalesce(per.win,0)*l.win_points + coalesce(per.draw,0)*l.draw_points + coalesce(per.loss,0)*l.loss_points),0)::int as points
  from teams
  cross join l
  left join per on per.tid = teams.id
  group by teams.id, teams.name
  order by points desc, wins desc;
$$;

grant execute on function public.generate_league_team_season(uuid) to authenticated;
grant execute on function public.record_league_team_result(uuid, int, int) to authenticated;
grant execute on function public.league_team_fixtures_list(uuid, int) to authenticated;
grant execute on function public.league_team_standings(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'league team fixtures (phase 2) installed' as ok;
