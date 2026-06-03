-- ============================================================================
-- Rollr — database schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: it drops and recreates the objects it owns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type belt_rank as enum ('white', 'blue', 'purple', 'brown', 'black');
exception when duplicate_object then null; end $$;

do $$ begin
  create type match_status as enum (
    'pending_opponent',  -- challenger created it, waiting for opponent to accept
    'pending_referee',   -- both agreed, waiting for referee to record the result
    'completed',         -- referee recorded a result; ratings applied
    'declined',          -- opponent declined
    'cancelled'          -- challenger/opponent cancelled before completion
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type result_type as enum ('submission', 'points', 'advantage', 'decision', 'draw');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles — one row per user, created automatically on sign-up
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique not null,
  display_name  text not null,
  belt_rank     belt_rank not null default 'white',
  rating        integer not null default 1200,
  wins          integer not null default 0,
  losses        integer not null default 0,
  draws         integer not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- matches — a single agreed-upon roll between two competitors + a referee
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id                       uuid primary key default gen_random_uuid(),
  challenger_id            uuid not null references public.profiles (id) on delete cascade,
  opponent_id              uuid not null references public.profiles (id) on delete cascade,
  referee_id               uuid not null references public.profiles (id) on delete cascade,
  status                   match_status not null default 'pending_opponent',
  winner_id                uuid references public.profiles (id),
  result                   result_type,
  method                   text,               -- e.g. "Rear naked choke", "Armbar"
  notes                    text,
  challenger_rating_before integer,
  opponent_rating_before   integer,
  challenger_rating_after  integer,
  opponent_rating_after    integer,
  created_at               timestamptz not null default now(),
  completed_at             timestamptz,
  -- the three people must be distinct
  constraint distinct_competitors check (challenger_id <> opponent_id),
  constraint referee_not_competitor check (referee_id <> challenger_id and referee_id <> opponent_id)
);

create index if not exists matches_challenger_idx on public.matches (challenger_id);
create index if not exists matches_opponent_idx   on public.matches (opponent_id);
create index if not exists matches_referee_idx    on public.matches (referee_id);
create index if not exists matches_status_idx     on public.matches (status);

-- ---------------------------------------------------------------------------
-- Auto-create a profile when a new auth user signs up.
-- username / display_name come from the sign-up metadata.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, belt_rank)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username', 'New Grappler'),
    coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Elo helper — expected score of A against B
-- ---------------------------------------------------------------------------
create or replace function public.elo_expected(rating_a integer, rating_b integer)
returns double precision
language sql immutable
as $$
  select 1.0 / (1.0 + power(10.0, (rating_b - rating_a) / 400.0));
$$;

-- ---------------------------------------------------------------------------
-- respond_to_match — opponent accepts or declines a pending challenge
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_match(p_match_id uuid, p_accept boolean)
returns public.matches
language plpgsql
security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.opponent_id <> auth.uid() then raise exception 'Only the opponent can respond'; end if;
  if m.status <> 'pending_opponent' then raise exception 'Match is no longer pending'; end if;

  update public.matches
     set status = case when p_accept then 'pending_referee'::match_status else 'declined'::match_status end
   where id = p_match_id
   returning * into m;
  return m;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_match — challenger or opponent cancels before completion
-- ---------------------------------------------------------------------------
create or replace function public.cancel_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id) then
    raise exception 'Only a competitor can cancel';
  end if;
  if m.status not in ('pending_opponent', 'pending_referee') then
    raise exception 'Match can no longer be cancelled';
  end if;

  update public.matches set status = 'cancelled' where id = p_match_id returning * into m;
  return m;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_match_result — referee records the outcome; ratings are applied here
-- (server-side so competitors can't tamper with their own rating)
-- ---------------------------------------------------------------------------
create or replace function public.record_match_result(
  p_match_id uuid,
  p_winner_id uuid,        -- null for a draw
  p_result result_type,
  p_method text default null,
  p_notes  text default null
)
returns public.matches
language plpgsql
security definer set search_path = public
as $$
declare
  m             public.matches;
  k             constant integer := 32;   -- Elo K-factor
  c_rating      integer;
  o_rating      integer;
  c_score       double precision;         -- challenger's actual score (1 / 0.5 / 0)
  o_score       double precision;
  c_expected    double precision;
  o_expected    double precision;
  c_new         integer;
  o_new         integer;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.referee_id <> auth.uid() then raise exception 'Only the referee can record the result'; end if;
  if m.status <> 'pending_referee' then raise exception 'Match is not ready to be scored'; end if;

  if p_result = 'draw' then
    if p_winner_id is not null then raise exception 'A draw has no winner'; end if;
  else
    if p_winner_id is null then raise exception 'A winner is required'; end if;
    if p_winner_id not in (m.challenger_id, m.opponent_id) then
      raise exception 'Winner must be one of the competitors';
    end if;
  end if;

  select rating into c_rating from public.profiles where id = m.challenger_id for update;
  select rating into o_rating from public.profiles where id = m.opponent_id for update;

  -- House rule: a DRAW is penalised like a LOSS for BOTH players,
  -- so each competitor scores 0.0 (same rating hit as losing).
  if p_result = 'draw' then
    c_score := 0.0; o_score := 0.0;
  elsif p_winner_id = m.challenger_id then
    c_score := 1.0; o_score := 0.0;
  else
    c_score := 0.0; o_score := 1.0;
  end if;

  c_expected := public.elo_expected(c_rating, o_rating);
  o_expected := public.elo_expected(o_rating, c_rating);
  c_new := round(c_rating + k * (c_score - c_expected));
  o_new := round(o_rating + k * (o_score - o_expected));

  -- apply rating + win/loss/draw tallies.
  -- (Tally is based on the actual result, NOT the rating score — a draw still
  -- counts as a draw in the W/L/D record even though it scores like a loss.)
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

  update public.matches
     set status = 'completed',
         winner_id = p_winner_id,
         result = p_result,
         method = p_method,
         notes = p_notes,
         challenger_rating_before = c_rating,
         opponent_rating_before   = o_rating,
         challenger_rating_after  = c_new,
         opponent_rating_after    = o_new,
         completed_at = now()
   where id = p_match_id
   returning * into m;

  return m;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.matches  enable row level security;

-- profiles: everyone signed in can read all profiles (leaderboard, picking
-- opponents). A user may edit ONLY their own display_name / belt_rank — column
-- privileges below stop them from touching rating / wins / losses.
drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Lock down which columns a normal user may update directly.
revoke update on public.profiles from authenticated;
grant  update (display_name, belt_rank) on public.profiles to authenticated;

-- matches: signed-in users can read all matches (transparency / history) and
-- create a match only as the challenger. All state changes go through the
-- security-definer functions above, so no direct UPDATE policy is granted.
drop policy if exists "matches_read_all" on public.matches;
create policy "matches_read_all" on public.matches
  for select to authenticated using (true);

drop policy if exists "matches_insert_as_challenger" on public.matches;
create policy "matches_insert_as_challenger" on public.matches
  for insert to authenticated with check (challenger_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime — let clients subscribe to match changes
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null; end $$;
