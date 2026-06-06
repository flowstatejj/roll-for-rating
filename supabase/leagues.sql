-- ============================================================================
-- Roll for Rating — Leagues (user-created local leagues w/ weekly auto-pairing)
-- Run in the Supabase SQL editor AFTER schema.sql, match-waive-and-wager.sql,
-- ror-mismatch-scaling.sql, seasons.sql. Safe to re-run.
--
-- A league is a local club (beer league, kids league, …) that meets on a set
-- weekday/time/place, runs a multi-week season, auto-pairs members each week,
-- and keeps W/L/D standings. A league is either:
--   • ranked  — its matches move global ROR + the overall W/L record (normal), OR
--   • casual  — results count ONLY toward league standings (no ROR / record change).
-- The organizer picks the scoring scheme (win/draw/loss points + a kill-submission
-- bonus and a break-submission bonus, so a choke can be worth more than a joint lock).
--
-- This file also SUPERSEDES _settle_match / record_match_result / confirm_match_result
-- (adds a sub_category arg + the casual fork). It drops the old overloads first.
-- ============================================================================

-- ---- Tables ----------------------------------------------------------------
create table if not exists public.leagues (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  description     text,
  audience        text not null default 'all'  check (audience in ('all','kids','adults')),
  ranked          boolean not null default false,
  visibility      text not null default 'open' check (visibility in ('open','private')),
  join_code       text not null unique,
  meet_day        int  not null default 0 check (meet_day between 0 and 6),  -- 0=Sun .. 6=Sat
  meet_time       text,
  location        text,
  city            text,
  state           text,
  country         text,
  gym_id          uuid references public.gyms(id) on delete set null,
  season_starts   date not null default current_date,
  weeks           int  not null default 8 check (weeks between 1 and 52),
  win_points      int  not null default 3,
  draw_points     int  not null default 1,
  loss_points     int  not null default 0,
  sub_kill_bonus  int  not null default 0,
  sub_break_bonus int  not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id   uuid not null references public.leagues(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('organizer','member')),
  joined_week int  not null default 1,
  active      boolean not null default true,
  joined_at   timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.league_fixtures (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  week_no    int  not null,
  player_a   uuid not null references public.profiles(id) on delete cascade,
  player_b   uuid references public.profiles(id) on delete cascade,  -- NULL = bye
  match_id   uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (league_id, week_no, player_a)
);

-- ---- matches: link to a league + capture submission category for scoring ----
alter table public.matches add column if not exists league_id    uuid references public.leagues(id) on delete set null;
alter table public.matches add column if not exists league_week  int;
alter table public.matches add column if not exists sub_category text check (sub_category in ('kill','break'));

create index if not exists idx_matches_league       on public.matches (league_id) where league_id is not null;
create index if not exists idx_league_members_user  on public.league_members (user_id);
create index if not exists idx_league_fixtures_lw    on public.league_fixtures (league_id, week_no);

-- ---- RLS -------------------------------------------------------------------
alter table public.leagues         enable row level security;
alter table public.league_members  enable row level security;
alter table public.league_fixtures enable row level security;

drop policy if exists "leagues_read" on public.leagues;
create policy "leagues_read" on public.leagues for select to authenticated using (true);
drop policy if exists "leagues_insert" on public.leagues;
create policy "leagues_insert" on public.leagues for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "leagues_update_own" on public.leagues;
create policy "leagues_update_own" on public.leagues for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "leagues_delete_own" on public.leagues;
create policy "leagues_delete_own" on public.leagues for delete to authenticated using (created_by = auth.uid());

drop policy if exists "league_members_read" on public.league_members;
create policy "league_members_read" on public.league_members for select to authenticated using (true);
drop policy if exists "league_members_join" on public.league_members;
create policy "league_members_join" on public.league_members for insert to authenticated
  with check (user_id = auth.uid() or exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid()));
drop policy if exists "league_members_leave" on public.league_members;
create policy "league_members_leave" on public.league_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid()));
drop policy if exists "league_members_update" on public.league_members;
create policy "league_members_update" on public.league_members for update to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid()));

drop policy if exists "league_fixtures_read" on public.league_fixtures;
create policy "league_fixtures_read" on public.league_fixtures for select to authenticated using (true);
-- fixtures are created by a SECURITY DEFINER function; a participant may link the match they played
drop policy if exists "league_fixtures_link" on public.league_fixtures;
create policy "league_fixtures_link" on public.league_fixtures for update to authenticated
  using (player_a = auth.uid() or player_b = auth.uid());

-- ---- Join-code generator (set as the column default) -----------------------
create or replace function public.gen_league_code()
returns text language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; code text; i int;  -- no ambiguous 0/O/1/I/L
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.leagues where join_code = code);
  end loop;
  return code;
end; $$;

alter table public.leagues alter column join_code set default public.gen_league_code();

-- ---- Helpers ---------------------------------------------------------------
-- The league's current week number (1-based), clamped to the season length.
create or replace function public.current_league_week(p_league_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select greatest(1, least(l.weeks, floor((current_date - l.season_starts) / 7)::int + 1))
  from public.leagues l where l.id = p_league_id;
$$;

-- Join a league by its code (self only). Returns the league id.
create or replace function public.join_league_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lid uuid; wk int;
begin
  select id into lid from public.leagues where upper(join_code) = upper(btrim(p_code));
  if lid is null then raise exception 'No league found for that code'; end if;
  wk := public.current_league_week(lid);
  insert into public.league_members (league_id, user_id, role, joined_week)
  values (lid, auth.uid(), 'member', wk)
  on conflict (league_id, user_id) do update set active = true;
  return lid;
end; $$;

-- Auto-pair a week's fixtures (organizer only). Round-robin "circle method"
-- over the active members who joined on/before this week. Odd roster → one bye.
-- Idempotent: does nothing if the week already has fixtures.
create or replace function public.generate_league_week(p_league_id uuid, p_week int)
returns void language plpgsql security definer set search_path = public as $$
declare
  is_org boolean; ids uuid[]; rot uuid[]; n int; half int; i int; a uuid; b uuid;
begin
  select (created_by = auth.uid()) into is_org from public.leagues where id = p_league_id;
  if not coalesce(is_org, false) then raise exception 'Only the organizer can generate fixtures'; end if;

  if exists (select 1 from public.league_fixtures where league_id = p_league_id and week_no = p_week) then
    return;  -- already generated
  end if;

  select array_agg(user_id order by joined_at) into ids
  from public.league_members
  where league_id = p_league_id and active and joined_week <= p_week;

  if ids is null or array_length(ids, 1) < 2 then return; end if;

  n := array_length(ids, 1);
  if n % 2 = 1 then ids := ids || array[null::uuid]; n := n + 1; end if;  -- bye placeholder

  -- position 1 fixed; rotate the rest by (p_week-1)
  rot := array[ids[1]];
  for i in 1..(n - 1) loop
    rot := rot || ids[2 + ((i - 1 + (p_week - 1)) % (n - 1))];
  end loop;

  half := n / 2;
  for i in 1..half loop
    a := rot[i];
    b := rot[n + 1 - i];
    if a is null or b is null then
      insert into public.league_fixtures (league_id, week_no, player_a, player_b)
      values (p_league_id, p_week, coalesce(a, b), null) on conflict do nothing;
    else
      insert into public.league_fixtures (league_id, week_no, player_a, player_b)
      values (p_league_id, p_week, a, b) on conflict do nothing;
    end if;
  end loop;
end; $$;

-- Standings for a league: per active member, aggregated from COMPLETED league
-- matches, scored by the league's configurable point scheme (+ submission bonus).
create or replace function public.league_standings(p_league_id uuid)
returns table (user_id uuid, played int, wins int, losses int, draws int, points int)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.leagues where id = p_league_id),
  mem as (
    select lm.user_id from public.league_members lm
    where lm.league_id = p_league_id and lm.active
  ),
  mt as (
    select * from public.matches where league_id = p_league_id and status = 'completed'
  ),
  per as (
    select mt.challenger_id as uid,
      case when mt.result <> 'draw' and mt.winner_id = mt.challenger_id then 1 else 0 end as win,
      case when mt.result <> 'draw' and mt.winner_id = mt.opponent_id   then 1 else 0 end as loss,
      case when mt.result = 'draw' then 1 else 0 end as draw,
      case when mt.winner_id = mt.challenger_id and mt.result = 'submission' then mt.sub_category end as won_sub
    from mt
    union all
    select mt.opponent_id as uid,
      case when mt.result <> 'draw' and mt.winner_id = mt.opponent_id   then 1 else 0 end as win,
      case when mt.result <> 'draw' and mt.winner_id = mt.challenger_id then 1 else 0 end as loss,
      case when mt.result = 'draw' then 1 else 0 end as draw,
      case when mt.winner_id = mt.opponent_id and mt.result = 'submission' then mt.sub_category end as won_sub
    from mt
  )
  select
    mem.user_id,
    coalesce(sum(coalesce(per.win,0) + coalesce(per.loss,0) + coalesce(per.draw,0)), 0)::int as played,
    coalesce(sum(per.win), 0)::int  as wins,
    coalesce(sum(per.loss), 0)::int as losses,
    coalesce(sum(per.draw), 0)::int as draws,
    coalesce(sum(
      coalesce(per.win,0)  * l.win_points  +
      coalesce(per.draw,0) * l.draw_points +
      coalesce(per.loss,0) * l.loss_points +
      case when per.won_sub = 'kill'  then l.sub_kill_bonus
           when per.won_sub = 'break' then l.sub_break_bonus
           else 0 end
    ), 0)::int as points
  from mem
  cross join l
  left join per on per.uid = mem.user_id
  group by mem.user_id
  order by points desc, wins desc;
$$;

-- ============================================================================
-- Settlement pipeline — recreated with a `sub_category` arg + the casual fork.
-- Drop old overloads first to avoid ambiguity.
-- ============================================================================
drop function if exists public._settle_match(uuid, uuid, result_type, text, text);
drop function if exists public.record_match_result(uuid, uuid, result_type, text, text);

create or replace function public._settle_match(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_method text, p_notes text, p_sub_category text default null
)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches; k constant integer := 32;
  c_rating integer; o_rating integer;
  c_score double precision; o_score double precision;
  c_expected double precision; o_expected double precision;
  c_new integer; o_new integer; c_delta integer; o_delta integer;
  mismatch double precision; is_casual boolean;
begin
  select * into m from public.matches where id = p_match_id for update;

  -- A casual (just-for-fun) league match records a result for standings but
  -- never touches global ROR, the W/L record, or wagers.
  is_casual := m.league_id is not null
    and coalesce((select not ranked from public.leagues where id = m.league_id), false);

  select rating into c_rating from public.profiles where id = m.challenger_id for update;
  select rating into o_rating from public.profiles where id = m.opponent_id  for update;

  if p_result = 'draw' then
    c_score := 0.0; o_score := 0.0;            -- draw penalised like a loss for both
  elsif p_winner_id = m.challenger_id then
    c_score := 1.0; o_score := 0.0;
  else
    c_score := 0.0; o_score := 1.0;
  end if;

  c_expected := public.elo_expected(c_rating, o_rating);
  o_expected := public.elo_expected(o_rating, c_rating);

  mismatch := greatest(0.0, 1 - abs(c_rating - o_rating) / 1000.0);

  c_delta := round(k * (c_score - c_expected) * mismatch);
  o_delta := round(k * (o_score - o_expected) * mismatch);

  if p_result <> 'draw' then
    if p_winner_id = m.challenger_id then
      c_delta := greatest(1, c_delta); o_delta := least(-1, o_delta);
    else
      o_delta := greatest(1, o_delta); c_delta := least(-1, c_delta);
    end if;
  end if;

  c_new := c_rating + c_delta;
  o_new := o_rating + o_delta;

  if p_result <> 'draw' and coalesce(m.wager, 0) > 0 then
    if p_winner_id = m.challenger_id then
      c_new := c_new + m.wager; o_new := o_new - m.wager;
    else
      o_new := o_new + m.wager; c_new := c_new - m.wager;
    end if;
  end if;

  c_new := greatest(100, c_new);
  o_new := greatest(100, o_new);

  if is_casual then
    -- no rating / record / wager changes; snapshots stay flat
    c_new := c_rating; o_new := o_rating;
  else
    update public.profiles
       set rating = c_new,
           wins   = wins   + (case when p_result <> 'draw' and p_winner_id = m.challenger_id then 1 else 0 end),
           losses = losses + (case when p_result <> 'draw' and p_winner_id = m.opponent_id  then 1 else 0 end),
           draws  = draws  + (case when p_result = 'draw' then 1 else 0 end)
     where id = m.challenger_id;

    update public.profiles
       set rating = o_new,
           wins   = wins   + (case when p_result <> 'draw' and p_winner_id = m.opponent_id  then 1 else 0 end),
           losses = losses + (case when p_result <> 'draw' and p_winner_id = m.challenger_id then 1 else 0 end),
           draws  = draws  + (case when p_result = 'draw' then 1 else 0 end)
     where id = m.opponent_id;
  end if;

  update public.matches
     set status = 'completed', winner_id = p_winner_id, result = p_result,
         method = p_method, notes = coalesce(p_notes, notes), result_proposed_by = null,
         sub_category = p_sub_category,
         challenger_rating_before = c_rating, opponent_rating_before = o_rating,
         challenger_rating_after = c_new, opponent_rating_after = o_new,
         completed_at = now()
   where id = p_match_id
   returning * into m;
  return m;
end; $$;

create or replace function public.record_match_result(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_method text default null, p_notes text default null, p_sub_category text default null
)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches; n_videos integer;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'pending_referee' then raise exception 'Match is not ready to be scored'; end if;

  if p_result = 'draw' then
    if p_winner_id is not null then raise exception 'A draw has no winner'; end if;
  else
    if p_winner_id is null then raise exception 'A winner is required'; end if;
    if p_winner_id not in (m.challenger_id, m.opponent_id) then
      raise exception 'Winner must be one of the competitors';
    end if;
  end if;

  if m.referee_waived then
    if auth.uid() not in (m.challenger_id, m.opponent_id) then
      raise exception 'Only a competitor can record a waived match';
    end if;
    select count(*) into n_videos from public.match_videos where match_id = m.id;
    if n_videos = 0 then
      raise exception 'A video of the match is required to record it without a referee.';
    end if;
    update public.matches
       set status = 'pending_confirmation', winner_id = p_winner_id, result = p_result,
           method = p_method, notes = p_notes, sub_category = p_sub_category, result_proposed_by = auth.uid()
     where id = m.id
     returning * into m;
    return m;
  else
    if m.referee_id <> auth.uid() then raise exception 'Only the referee can record the result'; end if;
    return public._settle_match(m.id, p_winner_id, p_result, p_method, p_notes, p_sub_category);
  end if;
end; $$;

create or replace function public.confirm_match_result(p_match_id uuid, p_accept boolean)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'pending_confirmation' then raise exception 'No result is awaiting confirmation'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id) then
    raise exception 'Only a competitor can confirm the result';
  end if;

  if p_accept then
    if auth.uid() = m.result_proposed_by then
      raise exception 'You logged this result — the other competitor has to confirm it';
    end if;
    return public._settle_match(m.id, m.winner_id, m.result, m.method, m.notes, m.sub_category);
  else
    update public.matches
       set status = 'pending_referee', winner_id = null, result = null,
           method = null, sub_category = null, result_proposed_by = null
     where id = m.id
     returning * into m;
    return m;
  end if;
end; $$;

-- ---- Keep the global Seasons points race out of league matches -------------
create or replace function public.accrue_season_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if new.status = 'completed' and (old.status is distinct from new.status)
     and new.result <> 'draw' and new.winner_id is not null
     and new.league_id is null then   -- league matches don't feed the global season
    sid := public.current_season();
    if sid is not null then
      insert into public.season_scores (season_id, user_id, points, wins)
      values (sid, new.winner_id, 10, 1)
      on conflict (season_id, user_id)
        do update set points = public.season_scores.points + 10, wins = public.season_scores.wins + 1;
    end if;
  end if;
  return new;
end; $$;
