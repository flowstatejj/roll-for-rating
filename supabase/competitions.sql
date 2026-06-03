-- ============================================================================
-- Rollr — Competition records (Smoothcomp / IBJJF / ADCC)
-- Run this in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

do $$ begin
  create type comp_source as enum ('smoothcomp', 'ibjjf', 'adcc', 'other');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- competition_records — a member's imported W/L from an external platform.
-- One *applied* record per (user, source): re-importing refreshes it.
-- ---------------------------------------------------------------------------
create table if not exists public.competition_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  source       comp_source not null,
  profile_url  text,
  wins         integer not null default 0,
  losses       integer not null default 0,
  verified     boolean not null default false,  -- true once read from the link by the server
  rating_delta integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists competition_records_user_idx on public.competition_records (user_id);

alter table public.competition_records enable row level security;

drop policy if exists "comp_read_own" on public.competition_records;
create policy "comp_read_own" on public.competition_records
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- import_competition_record — apply a member's external W/L to their rating.
-- Flat scoring (tunable): each win = +WIN_PTS, each loss = -LOSS_PTS.
-- Re-importing the same source REPLACES the previous contribution (idempotent).
-- ---------------------------------------------------------------------------
create or replace function public.import_competition_record(
  p_source comp_source,
  p_profile_url text,
  p_wins integer,
  p_losses integer,
  p_verified boolean default false
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  win_pts  constant integer := 15;
  loss_pts constant integer := 10;
  prev     public.competition_records;
  delta    integer;
  new_rating integer;
begin
  if p_wins < 0 or p_losses < 0 then raise exception 'Wins/losses cannot be negative'; end if;

  -- Undo any previous import from this source so re-importing refreshes it.
  select * into prev from public.competition_records
   where user_id = auth.uid() and source = p_source
   order by created_at desc limit 1;
  if found then
    update public.profiles
       set rating = rating - prev.rating_delta,
           wins   = greatest(0, wins - prev.wins),
           losses = greatest(0, losses - prev.losses)
     where id = auth.uid();
    delete from public.competition_records where id = prev.id;
  end if;

  delta := p_wins * win_pts - p_losses * loss_pts;

  update public.profiles
     set rating = rating + delta,
         wins   = wins + p_wins,
         losses = losses + p_losses
   where id = auth.uid()
   returning rating into new_rating;

  insert into public.competition_records (user_id, source, profile_url, wins, losses, verified, rating_delta)
  values (auth.uid(), p_source, p_profile_url, p_wins, p_losses, p_verified, delta);

  return jsonb_build_object(
    'source', p_source,
    'wins', p_wins,
    'losses', p_losses,
    'rating_delta', delta,
    'new_rating', new_rating
  );
end;
$$;
