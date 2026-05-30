-- ============================================================================
-- Roll for Rating — Seasons (a parallel points race that resets each season)
-- Run in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

create table if not exists public.seasons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.season_scores (
  season_id uuid not null references public.seasons (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  points    integer not null default 0,
  wins      integer not null default 0,
  primary key (season_id, user_id)
);

alter table public.seasons enable row level security;
alter table public.season_scores enable row level security;
drop policy if exists "seasons_read" on public.seasons;
create policy "seasons_read" on public.seasons for select to authenticated using (true);
drop policy if exists "season_scores_read" on public.season_scores;
create policy "season_scores_read" on public.season_scores for select to authenticated using (true);

-- The currently-running season (if any).
create or replace function public.current_season()
returns uuid language sql stable security definer set search_path = public
as $$ select id from public.seasons where now() between starts_at and ends_at order by starts_at desc limit 1 $$;

-- Accrue season points to the winner of a completed (decisive) match.
create or replace function public.accrue_season_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if new.status = 'completed' and (old.status is distinct from new.status)
     and new.result <> 'draw' and new.winner_id is not null then
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

drop trigger if exists trg_accrue_season on public.matches;
create trigger trg_accrue_season after update on public.matches
  for each row execute function public.accrue_season_points();

-- Seed a current season if none is running.
insert into public.seasons (name, starts_at, ends_at)
select 'Season 1', date_trunc('month', now()), date_trunc('month', now()) + interval '3 months'
where not exists (select 1 from public.seasons where now() between starts_at and ends_at);
