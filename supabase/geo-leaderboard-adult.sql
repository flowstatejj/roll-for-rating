-- ============================================================================
-- Roll for Rating - server-side geo-scoped ADULT leaderboard (audit Tier 1)
-- Run after profile-continent.sql / quests-kingslayer.sql (uses resolved_geo +
-- continent_for_country). Safe to re-run.
--
-- The client used to fetch the GLOBAL top-200 and filter by city/state/gym on
-- the device, so a city or gym board was wrong / mostly empty whenever the local
-- players weren't already in the global top-200. This ranks WITHIN the requested
-- scope on the server (mirrors kids_leaderboard) and returns ONLY safe columns
-- (no birthdate - it also replaces a client select('*') that would otherwise
-- break under profiles-pii.sql). Effective location is profile-first with gym
-- fallback, matching lib/geo.ts resolveGeo(). p_level in
-- gym|city|state|country|continent|world.
-- ============================================================================
create or replace function public.geo_leaderboard(p_level text default 'world', p_limit int default 200)
returns table(
  id uuid, username text, display_name text, belt_rank belt_rank, rating integer,
  wins integer, losses integer, draws integer,
  avatar_path text, avatar_warrior text, avatar_color text, is_founding_member boolean,
  weight_lbs numeric, gym_id uuid,
  city text, state text, country text, continent text
)
language sql stable security definer set search_path = public as $$
  with viewer as (
    select rg.city, rg.state, rg.country, rg.continent,
           (select p.gym_id from public.profiles p where p.id = auth.uid()) as gym_id
    from public.resolved_geo(auth.uid()) rg
  )
  select p.id, p.username, p.display_name, p.belt_rank, p.rating,
         p.wins, p.losses, p.draws,
         p.avatar_path, p.avatar_warrior, p.avatar_color, p.is_founding_member,
         p.weight_lbs, p.gym_id,
         coalesce(nullif(btrim(p.city), ''), g.city),
         coalesce(nullif(btrim(p.state), ''), g.state),
         coalesce(nullif(btrim(p.country), ''), g.country),
         coalesce(public.continent_for_country(coalesce(nullif(btrim(p.country), ''), g.country)), g.continent)
  from public.profiles p
  left join public.gyms g on g.id = p.gym_id
  cross join viewer v
  where p.age_tier <> 'kid'
    and p.participating
    and (
      p_level = 'world'
      or (p_level = 'gym'       and v.gym_id is not null and p.gym_id = v.gym_id)
      or (p_level = 'city'      and v.city      is not null and lower(coalesce(nullif(btrim(p.city),''), g.city))      = lower(v.city))
      or (p_level = 'state'     and v.state     is not null and lower(coalesce(nullif(btrim(p.state),''), g.state))     = lower(v.state))
      or (p_level = 'country'   and v.country   is not null and lower(coalesce(nullif(btrim(p.country),''), g.country)) = lower(v.country))
      or (p_level = 'continent' and v.continent is not null and lower(coalesce(public.continent_for_country(coalesce(nullif(btrim(p.country),''), g.country)), g.continent)) = lower(v.continent))
    )
  order by p.rating desc, p.id
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.geo_leaderboard(text, int) from public, anon;
grant execute on function public.geo_leaderboard(text, int) to authenticated;
