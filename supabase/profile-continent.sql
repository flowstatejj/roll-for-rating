-- ============================================================================
-- Roll for Rating — Stored continent on profiles
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The country picker writes a canonical country AND its continent, so the geo
-- leaderboards / King Slayer / Globe Trotter work for every country (not just
-- the ones in continent_for_country). Server geo now prefers the stored value,
-- falling back to continent_for_country (legacy free-text) then the gym.
-- ============================================================================

alter table public.profiles add column if not exists continent text;
grant update (continent) on public.profiles to authenticated;

-- Resolved geo prefers stored profile.continent.
create or replace function public.resolved_geo(p_uid uuid)
returns table(city text, state text, country text, continent text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.city), ''), g.city), coalesce(nullif(btrim(p.state), ''), g.state),
    coalesce(nullif(btrim(p.country), ''), g.country),
    coalesce(nullif(btrim(p.continent), ''),
             public.continent_for_country(coalesce(nullif(btrim(p.country), ''), g.country)), g.continent)
  from public.profiles p left join public.gyms g on g.id = p.gym_id where p.id = p_uid;
$$;

-- King Slayer scopes use the stored continent first.
create or replace function public.king_slayer_progress(p_uid uuid, p_level text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare ucity text; ustate text; ucountry text; ucont text; ugym uuid; king uuid;
begin
  select rg.city, rg.state, rg.country, rg.continent into ucity, ustate, ucountry, ucont from public.resolved_geo(p_uid) rg;
  select gym_id into ugym from public.profiles where id = p_uid;
  with cand as (
    select p.id, p.rating, p.gym_id,
      coalesce(nullif(btrim(p.city), ''), g.city) as city, coalesce(nullif(btrim(p.state), ''), g.state) as state,
      coalesce(nullif(btrim(p.country), ''), g.country) as country,
      coalesce(nullif(btrim(p.continent), ''),
               public.continent_for_country(coalesce(nullif(btrim(p.country), ''), g.country)), g.continent) as continent
    from public.profiles p left join public.gyms g on g.id = p.gym_id
    where p.id <> p_uid and p.age_tier <> 'kid'
  )
  select id into king from cand where case p_level
    when 'gym' then ugym is not null and gym_id = ugym
    when 'city' then ucity is not null and city is not null and lower(city) = lower(ucity)
    when 'state' then ustate is not null and state is not null and lower(state) = lower(ustate)
    when 'country' then ucountry is not null and country is not null and lower(country) = lower(ucountry)
    when 'continent' then ucont is not null and continent is not null and lower(continent) = lower(ucont)
    when 'world' then true else false end
  order by rating desc, id limit 1;
  if king is null then return 0; end if;
  if exists (select 1 from public.matches where status='completed' and winner_id=p_uid
    and ((challenger_id=p_uid and opponent_id=king) or (opponent_id=p_uid and challenger_id=king))) then return 1; end if;
  return 0;
end; $$;

-- Globe Trotter uses each opponent's stored continent first.
create or replace function public.globetrotter_progress(p_uid uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(distinct cont)::integer from (
    select coalesce(nullif(btrim(op.continent), ''),
                    public.continent_for_country(coalesce(nullif(btrim(op.country), ''), g.country)), g.continent) as cont
    from public.matches m
    join public.profiles op on op.id = case when m.challenger_id = p_uid then m.opponent_id else m.challenger_id end
    left join public.gyms g on g.id = op.gym_id
    where m.status='completed' and (m.challenger_id = p_uid or m.opponent_id = p_uid)
  ) q where cont is not null;
$$;

select 'profile-continent-installed' as ok;
