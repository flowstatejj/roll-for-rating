-- ============================================================================
-- Roll for Rating — Geographic leaderboard levels  [Phase A]
-- Run after social.sql + kids-leaderboard.sql. Safe to re-run.
--
-- A member's geography comes from their gym (city/state/country); continent is
-- derived in the app and stored on the gym. Boards can be filtered to
-- City / State / Country / Continent / World.
-- ============================================================================

alter table public.gyms add column if not exists state     text;
alter table public.gyms add column if not exists country   text;
alter table public.gyms add column if not exists continent text;

-- create_gym now also captures state / country / continent.
create or replace function public.create_gym(
  p_name text, p_city text, p_state text, p_country text, p_continent text, p_description text
)
returns public.gyms
language plpgsql security definer set search_path = public
as $$
declare g public.gyms;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Gym name is required'; end if;
  insert into public.gyms (name, city, state, country, continent, description, owner_id)
  values (
    trim(p_name),
    nullif(trim(p_city), ''),
    nullif(trim(p_state), ''),
    nullif(trim(p_country), ''),
    nullif(trim(p_continent), ''),
    nullif(trim(p_description), ''),
    auth.uid()
  )
  returning * into g;
  update public.profiles set gym_id = g.id where id = auth.uid();
  return g;
end; $$;

-- Owner can update their gym's location (column grant; RLS owner policy exists).
grant update (name, city, state, country, continent, description) on public.gyms to authenticated;

-- ---------------------------------------------------------------------------
-- 13-&-under board, now geo-filterable. Still returns ONLY first name + rating
-- (+ an opaque junior_id so a guardian can issue a challenge). Ranks are within
-- the selected scope. Visible only to minors + guardians of juniors.
-- ---------------------------------------------------------------------------
create or replace function public.kids_leaderboard(p_level text default 'world', p_limit int default 100)
returns table(junior_id uuid, rank bigint, first_name text, rating integer)
language sql stable security definer set search_path = public as $$
  with viewer as (
    select pr.age_tier,
           exists (select 1 from public.profiles j where j.managed_by = auth.uid()) as is_guardian,
           vg.city, vg.state, vg.country, vg.continent
    from public.profiles pr
    left join public.gyms vg on vg.id = pr.gym_id
    where pr.id = auth.uid()
  ),
  elig as (
    select p.id as junior_id, p.display_name, p.rating, p.created_at,
           g.city, g.state, g.country, g.continent
    from public.profiles p
    left join public.gyms g on g.id = p.gym_id
    cross join viewer v
    where p.age_tier = 'kid'
      and (p.wins + p.losses + p.draws) > 0
      and coalesce((v.age_tier <> 'adult') or v.is_guardian, false)
      and (
        p_level = 'world'
        or (p_level = 'city'      and v.city      is not null and lower(trim(g.city))      = lower(trim(v.city)))
        or (p_level = 'state'     and v.state     is not null and lower(trim(g.state))     = lower(trim(v.state)))
        or (p_level = 'country'   and v.country   is not null and lower(trim(g.country))   = lower(trim(v.country)))
        or (p_level = 'continent' and v.continent is not null and lower(trim(g.continent)) = lower(trim(v.continent)))
      )
  )
  select junior_id,
         row_number() over (order by rating desc, created_at asc) as rank,
         split_part(display_name, ' ', 1) as first_name,
         rating
  from elig
  order by rank
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.kids_leaderboard(text, int) from public, anon;
grant execute on function public.kids_leaderboard(text, int) to authenticated;
