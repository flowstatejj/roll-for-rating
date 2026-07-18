-- ============================================================================
-- Roll for Rating - LEAGUE TEAM SUB-BOUTS (Phase 3: member-vs-member scoring)
-- Run in the Supabase SQL editor AFTER league-team-fixtures.sql. Safe to re-run.
--
-- A team matchup is now scored by recording the actual member-vs-member matches
-- that make it up, which COMPUTES the team score (instead of the organizer
-- typing a final 3-2). Two formats, mirroring the tournament sub-bout engine
-- (record_subbout in tournaments-pro.sql):
--   duel     (2v2 / 3v3): each slot fights its counterpart once; most wins takes
--                         the matchup (tie -> draw).
--   quintet  (5v5):       winner-stays survivor run; a side wins when it
--                         eliminates all of the other team's fighters.
--
-- The direct-score path (record_league_team_result, Phase 2) is kept as a quick
-- fallback but now refuses once any sub-bout exists, so the two paths can never
-- disagree on a fixture.
-- ============================================================================

-- Survivor pointers on the fixture (mirror tournament_bouts.a_idx / b_idx).
-- 1-based index into each team's slot-ordered roster: the fighter currently on
-- the mat for that side. Duel advances both each sub-bout; quintet advances only
-- the loser's side (winner stays).
alter table public.league_team_fixtures add column if not exists a_idx int not null default 1;
alter table public.league_team_fixtures add column if not exists b_idx int not null default 1;

-- One recorded member-vs-member match inside a team fixture.
create table if not exists public.league_team_subbouts (
  id           uuid primary key default gen_random_uuid(),
  fixture_id   uuid not null references public.league_team_fixtures(id) on delete cascade,
  order_no     int  not null,
  a_user       uuid references public.profiles(id) on delete set null,
  b_user       uuid references public.profiles(id) on delete set null,
  winner       text check (winner in ('a','b','draw')),
  result       result_type,
  sub_category text check (sub_category in ('kill','break')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_lts_fixture on public.league_team_subbouts (fixture_id, order_no);

alter table public.league_team_subbouts enable row level security;
drop policy if exists "lts_read" on public.league_team_subbouts;
create policy "lts_read" on public.league_team_subbouts for select to authenticated using (true);
-- Written only by the SECURITY DEFINER functions below (no direct writes).

-- ---------------------------------------------------------------------------
-- record_league_team_subbout - organizer records one member-vs-member match of
-- a team fixture; computes the running team score and, when the matchup is
-- decided, sets the fixture winner/status. Mirrors public.record_subbout.
-- ---------------------------------------------------------------------------
create or replace function public.record_league_team_subbout(
  p_fixture uuid, p_winner text, p_result result_type,
  p_sub_category text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.league_team_fixtures; tr text; sz int; au uuid; bu uuid; ord int;
  a_roster uuid[]; b_roster uuid[]; alen int; blen int;
  decided boolean := false; team_win text;
begin
  if p_winner not in ('a','b','draw') then raise exception 'Winner must be a, b or draw'; end if;
  select * into f from public.league_team_fixtures where id = p_fixture for update;
  if not found then raise exception 'Fixture not found'; end if;
  if not public.is_league_organizer(f.league_id) then raise exception 'Only the organizer can record results'; end if;
  if f.status = 'bye' then raise exception 'A bye has no result'; end if;
  if f.status = 'done' then raise exception 'This matchup is already finished'; end if;
  if f.team_a is null or f.team_b is null then raise exception 'Both teams are required'; end if;

  select team_rule, team_size into tr, sz from public.leagues where id = f.league_id;
  if coalesce(tr, 'none') = 'none' then raise exception 'This is an individual league'; end if;

  select array_agg(user_id order by coalesce(slot, 999), user_id) into a_roster
    from public.league_team_members where team_id = f.team_a;
  select array_agg(user_id order by coalesce(slot, 999), user_id) into b_roster
    from public.league_team_members where team_id = f.team_b;
  if a_roster is null or b_roster is null then raise exception 'Both teams need a roster before scoring'; end if;
  alen := coalesce(array_length(a_roster, 1), 0);
  blen := coalesce(array_length(b_roster, 1), 0);
  if f.a_idx > alen or f.b_idx > blen then
    raise exception 'No fighter left to record for one side';
  end if;

  au := a_roster[f.a_idx]; bu := b_roster[f.b_idx];
  select coalesce(max(order_no), 0) + 1 into ord from public.league_team_subbouts where fixture_id = p_fixture;
  insert into public.league_team_subbouts (fixture_id, order_no, a_user, b_user, winner, result, sub_category)
  values (p_fixture, ord, au, bu, p_winner, p_result, p_sub_category);

  if tr = 'quintet' then
    -- winner stays; loser advances to next fighter; a draw eliminates both.
    if p_winner = 'a' then f.b_idx := f.b_idx + 1; f.a_score := f.a_score + 1;
    elsif p_winner = 'b' then f.a_idx := f.a_idx + 1; f.b_score := f.b_score + 1;
    else f.a_idx := f.a_idx + 1; f.b_idx := f.b_idx + 1; end if;
    update public.league_team_fixtures
       set a_idx = f.a_idx, b_idx = f.b_idx, a_score = f.a_score, b_score = f.b_score
     where id = p_fixture;
    -- Decide against each team's ACTUAL roster length (not the nominal team_size)
    -- so an under-strength quintet team can still be swept and the fixture never
    -- stalls. A side is out once its survivor pointer passes its last fighter.
    if f.a_idx > alen and f.b_idx > blen then decided := true; team_win := 'draw';
    elsif f.b_idx > blen then decided := true; team_win := 'a';
    elsif f.a_idx > alen then decided := true; team_win := 'b';
    end if;
  else
    -- duel: fixed positions (slot N vs slot N); advance both pointers each match.
    if p_winner = 'a' then f.a_score := f.a_score + 1;
    elsif p_winner = 'b' then f.b_score := f.b_score + 1; end if;
    f.a_idx := f.a_idx + 1; f.b_idx := f.b_idx + 1;
    update public.league_team_fixtures
       set a_idx = f.a_idx, b_idx = f.b_idx, a_score = f.a_score, b_score = f.b_score
     where id = p_fixture;
    -- Decide against the SHORTER of nominal team_size and actual roster length
    -- (like the quintet branch) so an under-strength duel roster never stalls;
    -- unfillable slots simply play no bout.
    if (f.a_idx > least(sz, alen)) or (f.b_idx > least(sz, blen)) then
      decided := true;
      team_win := case when f.a_score > f.b_score then 'a' when f.b_score > f.a_score then 'b' else 'draw' end;
    end if;
  end if;

  if decided then
    update public.league_team_fixtures set winner = team_win, status = 'done' where id = p_fixture;
    -- Playoff bracket: push the advancer into the next round (dormant for season
    -- play; _advance_league_playoff lives in league-team-playoff.sql / Phase 4).
    if f.bracket = 'playoff' then perform public._advance_league_playoff(p_fixture); end if;
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- reset_league_team_matchup - organizer clears a fixture's sub-bouts and score
-- so it can be re-run (useful for corrections / demos). A bye is untouched.
-- For a PLAYOFF fixture that already advanced a team, this also UN-advances it
-- (clears the slot it fed in the next round) so the bracket stays consistent;
-- it refuses if that next fixture has already been played, to avoid orphaning a
-- team deeper in the bracket.
-- ---------------------------------------------------------------------------
create or replace function public.reset_league_team_matchup(p_fixture uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f public.league_team_fixtures; nstat text; naidx int; nbidx int;
begin
  select * into f from public.league_team_fixtures where id = p_fixture for update;
  if not found then raise exception 'Fixture not found'; end if;
  if not public.is_league_organizer(f.league_id) then raise exception 'Only the organizer can reset a matchup'; end if;
  if f.status = 'bye' then raise exception 'A bye has no result to reset'; end if;

  -- Playoff: undo the advance into the next round before clearing this result.
  if f.bracket = 'playoff' and f.next_fixture_id is not null then
    select status, a_idx, b_idx into nstat, naidx, nbidx
      from public.league_team_fixtures where id = f.next_fixture_id for update;
    -- Refuse if the next round has BEGUN (done, pointers advanced, or any sub-bout
    -- recorded) - un-advancing then would corrupt a live/finished downstream matchup.
    if nstat = 'done' or coalesce(naidx, 1) > 1 or coalesce(nbidx, 1) > 1
       or exists (select 1 from public.league_team_subbouts s where s.fixture_id = f.next_fixture_id) then
      raise exception 'The next round has already begun; reset that matchup first';
    end if;
    -- This fixture only ever feeds its own next_slot, so clearing it is safe.
    if f.next_slot = 'a' then
      update public.league_team_fixtures set team_a = null where id = f.next_fixture_id;
    else
      update public.league_team_fixtures set team_b = null where id = f.next_fixture_id;
    end if;
  end if;

  delete from public.league_team_subbouts where fixture_id = p_fixture;
  update public.league_team_fixtures
     set a_idx = 1, b_idx = 1, a_score = 0, b_score = 0, winner = null, status = 'pending'
   where id = p_fixture;
end; $$;

-- ---------------------------------------------------------------------------
-- Sub-bouts of a fixture (with fighter names) for the matchup runner UI.
-- ---------------------------------------------------------------------------
create or replace function public.league_team_subbouts_list(p_fixture uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id, 'order_no', s.order_no,
      'a_user', s.a_user, 'b_user', s.b_user,
      'a_name', pa.display_name, 'b_name', pb.display_name,
      'winner', s.winner, 'result', s.result, 'sub_category', s.sub_category
    ) order by s.order_no
  ), '[]'::jsonb)
  from public.league_team_subbouts s
  left join public.profiles pa on pa.id = s.a_user
  left join public.profiles pb on pb.id = s.b_user
  where s.fixture_id = p_fixture;
$$;

-- ---------------------------------------------------------------------------
-- league_team_fixtures_list (Phase 2, REDEFINED here) - same shape plus a_idx /
-- b_idx / sub_count so the season screen can show an in-progress matchup. Kept
-- here (not in league-team-fixtures.sql) so the reference to league_team_subbouts
-- resolves - the table is created above. Signature MUST match phase 2.
-- ---------------------------------------------------------------------------
create or replace function public.league_team_fixtures_list(p_league uuid, p_week int default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id, 'week_no', f.week_no, 'bracket', f.bracket,
      'team_a', f.team_a, 'team_b', f.team_b,
      'team_a_name', ta.name, 'team_b_name', tb.name,
      'a_score', f.a_score, 'b_score', f.b_score, 'winner', f.winner, 'status', f.status,
      'a_idx', f.a_idx, 'b_idx', f.b_idx,
      'sub_count', (select count(*) from public.league_team_subbouts s where s.fixture_id = f.id)
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
-- record_league_team_result (Phase 2, REDEFINED here) - the quick direct-score
-- path. Now refuses once any sub-bout exists so it can never overwrite a
-- sub-bout-derived score. Signature MUST match league-team-fixtures.sql.
-- ---------------------------------------------------------------------------
create or replace function public.record_league_team_result(p_fixture uuid, p_a_score int, p_b_score int)
returns void language plpgsql security definer set search_path = public as $$
declare f public.league_team_fixtures; w text;
begin
  select * into f from public.league_team_fixtures where id = p_fixture for update;
  if not found then raise exception 'Fixture not found'; end if;
  if not public.is_league_organizer(f.league_id) then raise exception 'Only the organizer can record results'; end if;
  if f.status = 'bye' then raise exception 'A bye has no result'; end if;
  -- A finished PLAYOFF fixture must not be re-scored directly (it would re-run
  -- _advance_league_playoff and stomp an already-played next round); force
  -- corrections through reset_league_team_matchup, which un-advances safely.
  -- Season fixtures may still be corrected in place.
  if f.status = 'done' and f.bracket = 'playoff' then
    raise exception 'This playoff matchup is finished; reset it to change the result';
  end if;
  if f.team_a is null or f.team_b is null then raise exception 'Both teams are required'; end if;
  if p_a_score < 0 or p_b_score < 0 then raise exception 'Scores must be >= 0'; end if;
  if exists (select 1 from public.league_team_subbouts where fixture_id = p_fixture) then
    raise exception 'This matchup is being scored match-by-match; reset it to enter a score directly';
  end if;

  w := case when p_a_score > p_b_score then 'a' when p_b_score > p_a_score then 'b' else 'draw' end;
  update public.league_team_fixtures
     set a_score = p_a_score, b_score = p_b_score, winner = w, status = 'done'
   where id = p_fixture;
  -- Playoff bracket advancement (dormant for season play; see Phase 4).
  if f.bracket = 'playoff' then perform public._advance_league_playoff(p_fixture); end if;
end; $$;

grant execute on function public.record_league_team_subbout(uuid, text, result_type, text) to authenticated;
grant execute on function public.reset_league_team_matchup(uuid) to authenticated;
grant execute on function public.league_team_subbouts_list(uuid) to authenticated;
grant execute on function public.league_team_fixtures_list(uuid, int) to authenticated;
grant execute on function public.record_league_team_result(uuid, int, int) to authenticated;

notify pgrst, 'reload schema';
select 'league team sub-bouts (phase 3) installed' as ok;
