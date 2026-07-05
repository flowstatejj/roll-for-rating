-- ============================================================================
-- Roll for Rating - Watch feed search + filters
-- Returns the ids of PUBLIC completed matches matching a text search (either
-- competitor's name/username) and optional filters: geo scope (of either
-- competitor, viewer-relative, like the leaderboard), belt, rating band, and
-- submission (the match method). The client fetches the full match rows for
-- these ids. Run after quests-kingslayer.sql / geo helpers (uses resolved_geo +
-- continent_for_country). Safe to re-run.
-- ============================================================================
create or replace function public.search_public_match_ids(
  p_search     text default null,
  p_level      text default 'world',
  p_belt       text default null,
  p_min_rating int  default null,
  p_max_rating int  default null,
  p_submission text default null,
  p_limit      int  default 50
)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with viewer as (
    select rg.city, rg.state, rg.country, rg.continent,
           (select p.gym_id from public.profiles p where p.id = auth.uid()) as gym_id
    from public.resolved_geo(auth.uid()) rg
  ),
  m as (
    select mt.id, mt.completed_at, mt.method,
      pc.display_name c_name, pc.username c_user, pc.belt_rank::text c_belt, pc.rating c_rating, pc.gym_id c_gym,
      coalesce(nullif(btrim(pc.city),''),    gc.city)    c_city,
      coalesce(nullif(btrim(pc.state),''),   gc.state)   c_state,
      coalesce(nullif(btrim(pc.country),''), gc.country) c_country,
      coalesce(public.continent_for_country(coalesce(nullif(btrim(pc.country),''), gc.country)), gc.continent) c_cont,
      po.display_name o_name, po.username o_user, po.belt_rank::text o_belt, po.rating o_rating, po.gym_id o_gym,
      coalesce(nullif(btrim(po.city),''),    go.city)    o_city,
      coalesce(nullif(btrim(po.state),''),   go.state)   o_state,
      coalesce(nullif(btrim(po.country),''), go.country) o_country,
      coalesce(public.continent_for_country(coalesce(nullif(btrim(po.country),''), go.country)), go.continent) o_cont
    from public.matches mt
    join public.profiles pc on pc.id = mt.challenger_id
    left join public.gyms gc on gc.id = pc.gym_id
    join public.profiles po on po.id = mt.opponent_id
    left join public.gyms go on go.id = po.gym_id
    where mt.is_public and mt.status = 'completed'
  )
  select m.id
  from m cross join viewer v
  where
    (nullif(btrim(coalesce(p_search, '')), '') is null
      or m.c_name ilike '%' || p_search || '%' or m.c_user ilike '%' || p_search || '%'
      or m.o_name ilike '%' || p_search || '%' or m.o_user ilike '%' || p_search || '%')
    and (p_belt is null or m.c_belt = p_belt or m.o_belt = p_belt)
    and (
      (p_min_rating is null and p_max_rating is null)
      or m.c_rating between coalesce(p_min_rating, 0) and coalesce(p_max_rating, 1000000)
      or m.o_rating between coalesce(p_min_rating, 0) and coalesce(p_max_rating, 1000000)
    )
    and (p_submission is null or m.method = p_submission)
    and (
      p_level is null or p_level = 'world'
      or (p_level = 'gym'       and v.gym_id    is not null and (m.c_gym = v.gym_id or m.o_gym = v.gym_id))
      or (p_level = 'city'      and v.city      is not null and (lower(m.c_city)    = lower(v.city)      or lower(m.o_city)    = lower(v.city)))
      or (p_level = 'state'     and v.state     is not null and (lower(m.c_state)   = lower(v.state)     or lower(m.o_state)   = lower(v.state)))
      or (p_level = 'country'   and v.country   is not null and (lower(m.c_country) = lower(v.country)   or lower(m.o_country) = lower(v.country)))
      or (p_level = 'continent' and v.continent is not null and (lower(m.c_cont)    = lower(v.continent) or lower(m.o_cont)    = lower(v.continent)))
    )
  order by m.completed_at desc
  limit greatest(1, least(p_limit, 100));
$$;
grant execute on function public.search_public_match_ids(text, text, text, int, int, text, int) to authenticated;

notify pgrst, 'reload schema';
select 'watch-search installed' as ok;
