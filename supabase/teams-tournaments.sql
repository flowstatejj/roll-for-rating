-- ============================================================================
-- Roll for Rating — Teams (gym power ranking) + Tournaments (point-race events)
-- Run in the Supabase SQL Editor (after schema.sql + social.sql). Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Teams: rank gyms by their members' average rating
-- ---------------------------------------------------------------------------
create or replace function public.gym_power_ranking()
returns table (gym_id uuid, name text, city text, member_count bigint, avg_rating integer, total_wins bigint)
language sql stable security definer set search_path = public
as $$
  select g.id, g.name, g.city,
         count(p.id) as member_count,
         coalesce(round(avg(p.rating)), 0)::integer as avg_rating,
         coalesce(sum(p.wins), 0) as total_wins
  from public.gyms g
  join public.profiles p on p.gym_id = g.id
  group by g.id, g.name, g.city
  order by avg(p.rating) desc nulls last
  limit 100;
$$;

-- ---------------------------------------------------------------------------
-- Tournaments: a named event; entrants race on wins during the window
-- ---------------------------------------------------------------------------
create table if not exists public.tournaments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  host_id    uuid not null references public.profiles (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_entrants (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  joined_at     timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

alter table public.tournaments enable row level security;
alter table public.tournament_entrants enable row level security;

drop policy if exists "tournaments_read" on public.tournaments;
create policy "tournaments_read" on public.tournaments for select to authenticated using (true);
drop policy if exists "tournaments_insert" on public.tournaments;
create policy "tournaments_insert" on public.tournaments for insert to authenticated with check (host_id = auth.uid());

drop policy if exists "entrants_read" on public.tournament_entrants;
create policy "entrants_read" on public.tournament_entrants for select to authenticated using (true);
drop policy if exists "entrants_insert" on public.tournament_entrants;
create policy "entrants_insert" on public.tournament_entrants for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "entrants_delete" on public.tournament_entrants;
create policy "entrants_delete" on public.tournament_entrants for delete to authenticated using (user_id = auth.uid());

-- Standings: entrants ranked by wins inside the tournament window.
create or replace function public.tournament_standings(p_tid uuid)
returns table (user_id uuid, display_name text, belt_rank belt_rank, rating integer, wins bigint)
language sql stable security definer set search_path = public
as $$
  select p.id, p.display_name, p.belt_rank, p.rating,
    (select count(*) from public.matches m
       where m.status = 'completed' and m.winner_id = p.id
         and m.completed_at between t.starts_at and t.ends_at) as wins
  from public.tournament_entrants e
  join public.profiles p on p.id = e.user_id
  join public.tournaments t on t.id = e.tournament_id
  where e.tournament_id = p_tid
  order by wins desc, p.rating desc;
$$;
