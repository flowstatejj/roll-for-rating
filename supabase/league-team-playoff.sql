-- ============================================================================
-- Roll for Rating - LEAGUE TEAM PLAYOFF (Phase 4: season -> single-elim bracket)
-- Run in the Supabase SQL editor AFTER league-team-subbouts.sql. Safe to re-run.
--
-- A team league ends in a playoff. The organizer seeds the top N teams by final
-- season standings into a standard single-elimination bracket (byes for a non-
-- power-of-two field). Each bracket matchup is scored with the SAME member-vs-
-- member runner as the season (record_league_team_subbout / _result), and the
-- winner is pushed into the next round automatically.
--
-- Playoff draw handling (an improvement over the tournament bracket, which
-- dead-ends a drawn elimination bout): a drawn bracket matchup advances the
-- BETTER SEED. Seeds are stamped on league_teams.seed at generation time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- _advance_league_playoff - push a finished bracket matchup's winner into its
-- next fixture. Called from the record functions (league-team-subbouts.sql) when
-- a playoff fixture is decided, and from the bye pre-advance below. A draw
-- advances the better (lower) seed.
-- ---------------------------------------------------------------------------
create or replace function public._advance_league_playoff(p_fixture uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f public.league_team_fixtures; adv uuid; sa int; sb int;
begin
  select * into f from public.league_team_fixtures where id = p_fixture;
  if not found or f.next_fixture_id is null then return; end if;
  if f.winner = 'a' then adv := f.team_a;
  elsif f.winner = 'b' then adv := f.team_b;
  else
    -- Drawn matchup: advance the better seed (lower number). Deterministic
    -- fallback to team_a when seeds are missing/equal.
    select seed into sa from public.league_teams where id = f.team_a;
    select seed into sb from public.league_teams where id = f.team_b;
    if sb is null then adv := f.team_a;
    elsif sa is null then adv := f.team_b;
    elsif sa <= sb then adv := f.team_a; else adv := f.team_b; end if;
  end if;
  if adv is null then return; end if;
  if f.next_slot = 'a' then
    update public.league_team_fixtures set team_a = adv where id = f.next_fixture_id;
  else
    update public.league_team_fixtures set team_b = adv where id = f.next_fixture_id;
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- _gen_league_playoff_bracket - build the single-elim bracket over `ids`
-- (best-seed first). Mirrors the tournament _gen_single_elim: standard seed slot
-- order, byes for seeds beyond the field, fixtures created final-round first so
-- children can link to parents via next_fixture_id / next_slot.
-- ---------------------------------------------------------------------------
create or replace function public._gen_league_playoff_bracket(p_league uuid, ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  n int; size int; rounds int; r int; i int; cnt int;
  slotorder int[]; slots uuid[]; cur uuid[]; nxt uuid[]; r1 uuid[];
  fid uuid; parent uuid; a uuid; b uuid; base int; per_round int; j int;
begin
  n := array_length(ids, 1);
  if n is null or n < 2 then return; end if;
  size := 1; while size < n loop size := size * 2; end loop;
  rounds := 0; cnt := size; while cnt > 1 loop rounds := rounds + 1; cnt := cnt / 2; end loop;

  -- standard seed slot order for a bracket of `size` (1-indexed seeds)
  slotorder := array[1]; cnt := 1;
  while cnt < size loop
    declare tmp int[] := '{}'; s int;
    begin
      foreach s in array slotorder loop
        tmp := tmp || s;
        tmp := tmp || (cnt * 2 + 1 - s);
      end loop;
      slotorder := tmp; cnt := cnt * 2;
    end;
  end loop;

  -- place seeds into slots; seed > n => bye (null)
  slots := '{}';
  for i in 1..size loop
    if slotorder[i] <= n then slots := slots || ids[slotorder[i]]; else slots := slots || null::uuid; end if;
  end loop;

  -- playoff weeks sit after the season so week-ordered views stay sensible
  base := coalesce((select max(week_no) from public.league_team_fixtures where league_id = p_league and bracket = 'season'),
                   (select weeks from public.leagues where id = p_league), 0);

  -- create final..first; nxt holds the just-created round's ids (the parents)
  nxt := '{}'; r1 := '{}';
  for r in reverse rounds..1 loop
    per_round := size / (2 ^ r)::int;
    cur := '{}';
    for i in 1..per_round loop
      if r = rounds then parent := null; else parent := nxt[((i - 1) / 2) + 1]; end if;
      insert into public.league_team_fixtures (league_id, bracket, week_no, round_no, next_fixture_id, next_slot, status)
      values (p_league, 'playoff', base + r, r, parent, case when (i % 2) = 1 then 'a' else 'b' end, 'pending')
      returning id into fid;
      cur := cur || fid;
    end loop;
    nxt := cur;
    if r = 1 then r1 := cur; end if;
  end loop;

  -- fill round 1 competitors from slots, set byes, pre-advance byes
  j := 1;
  foreach fid in array r1 loop
    a := slots[j]; b := slots[j + 1]; j := j + 2;
    if a is null and b is not null then a := b; b := null; end if;  -- present team always in slot a
    update public.league_team_fixtures set team_a = a, team_b = b where id = fid;
    if a is not null and b is null then
      update public.league_team_fixtures set status = 'bye', winner = 'a' where id = fid;
      perform public._advance_league_playoff(fid);
    end if;
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- league_team_standings (Phase 2, REDEFINED here) - identical shape, but with a
-- DETERMINISTIC final tiebreak (draws desc, then team_id) so playoff seeding is
-- reproducible when teams are level on points + wins. Signature MUST match
-- league-team-fixtures.sql. Kept here because seeding depends on stable order.
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
  order by points desc, wins desc, draws desc, teams.id;
$$;

-- ---------------------------------------------------------------------------
-- generate_league_team_playoff - organizer seeds the top N teams (by season
-- standings) into the bracket. Idempotent (returns 'already' if a playoff
-- exists). p_top defaults to 8; clamped to at least 2 and the teams available.
-- ---------------------------------------------------------------------------
create or replace function public.generate_league_team_playoff(p_league uuid, p_top int default 8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; k int; i int; sz int; rnds int;
begin
  if not public.is_league_organizer(p_league) then raise exception 'Only the organizer can start the playoff'; end if;
  perform 1 from public.leagues where id = p_league for update;
  if coalesce((select team_rule from public.leagues where id = p_league), 'none') = 'none' then
    raise exception 'This is an individual league';
  end if;
  if exists (select 1 from public.league_team_fixtures where league_id = p_league and bracket = 'playoff') then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;

  -- Seed by final season standings (deterministic order); take the top N. The
  -- explicit array_agg ORDER BY guarantees seed 1 = best team regardless of how
  -- the planner returns the subquery rows.
  select array_agg(team_id order by points desc, wins desc, draws desc, team_id) into ids from (
    select team_id, points, wins, draws from public.league_team_standings(p_league) limit greatest(2, p_top)
  ) s;
  if ids is null or array_length(ids, 1) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'need_2_teams');
  end if;
  k := array_length(ids, 1);

  -- Stamp seeds 1..k so a drawn bracket matchup can be broken by seeding.
  for i in 1..k loop
    update public.league_teams set seed = i where id = ids[i];
  end loop;

  perform public._gen_league_playoff_bracket(p_league, ids);

  sz := 1; while sz < k loop sz := sz * 2; end loop;
  rnds := 0; while sz > 1 loop rnds := rnds + 1; sz := sz / 2; end loop;
  return jsonb_build_object('ok', true, 'teams', k, 'rounds', rnds);
end; $$;

-- ---------------------------------------------------------------------------
-- league_team_playoff_list - the bracket for display: fixtures with team names +
-- seeds, ordered by round then creation (= bracket position).
-- ---------------------------------------------------------------------------
create or replace function public.league_team_playoff_list(p_league uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id, 'round_no', f.round_no, 'week_no', f.week_no, 'bracket', f.bracket,
      'team_a', f.team_a, 'team_b', f.team_b,
      'team_a_name', ta.name, 'team_b_name', tb.name,
      'team_a_seed', ta.seed, 'team_b_seed', tb.seed,
      'a_score', f.a_score, 'b_score', f.b_score, 'winner', f.winner, 'status', f.status,
      'a_idx', f.a_idx, 'b_idx', f.b_idx,
      'sub_count', (select count(*) from public.league_team_subbouts s where s.fixture_id = f.id)
    ) order by f.round_no, f.created_at
  ), '[]'::jsonb)
  from public.league_team_fixtures f
  left join public.league_teams ta on ta.id = f.team_a
  left join public.league_teams tb on tb.id = f.team_b
  where f.league_id = p_league and f.bracket = 'playoff';
$$;

-- Internal helpers: callable only within SECURITY DEFINER functions (they run as
-- owner). Revoke the Supabase default grants so clients can't call them directly.
-- NOTE: must include PUBLIC - Postgres grants EXECUTE to PUBLIC on CREATE, and
-- anon/authenticated inherit it, so revoking from those roles alone is not enough
-- (see harden-internal-functions.sql).
revoke execute on function public._advance_league_playoff(uuid) from public, anon, authenticated;
revoke execute on function public._gen_league_playoff_bracket(uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.generate_league_team_playoff(uuid, int) to authenticated;
grant execute on function public.league_team_playoff_list(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'league team playoff (phase 4) installed' as ok;
