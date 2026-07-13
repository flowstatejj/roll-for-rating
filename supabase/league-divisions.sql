-- ============================================================================
-- Roll for Rating - LEAGUE DIVISIONS (belt/age/weight/rating/gender + Gi/No-Gi)
-- Run in the Supabase SQL editor AFTER shared-eligibility.sql AND leagues.sql
-- (and league-rulesets.sql). Safe to re-run.
--
-- Brings tournament-style divisions to leagues, adapted to the league model:
-- a league runs a MULTI-WEEK season with weekly round-robin pairing, so a league
-- division has NO bracket format (single/double-elim) - it is always the weekly
-- circle method, scoped to the division's roster. Eligibility (belt/age/weight/
-- rating/gender with directional age flex + Gi/No-Gi) reuses the shared
-- _eligibility_check core so the rules never drift from tournaments.
--
-- BACK-COMPAT: divisions are OPTIONAL. A league with zero divisions keeps its
-- exact legacy single-pool behavior (the dispatch's else-branch below). The
-- coarse `audience` field stays as a browse filter; divisions supersede it as
-- the functional pairing/eligibility unit once present.
--
-- *** OWNERSHIP NOTE ***
-- THIS FILE OWNS public.generate_league_week. It SUPERSEDES the single-pool
-- version in leagues.sql by adding a "if the league has divisions, fan out to
-- each division" branch. The legacy single-pool body is preserved verbatim as
-- the else-branch. Always run this file AFTER leagues.sql.
--
-- PROD RE-RUN ORDER (idempotent):
--   ... -> shared-eligibility.sql -> tournament-divisions-v2.sql ->
--   leagues.sql -> league-rulesets.sql -> league-divisions.sql
--   (ror-symmetric-stake.sql stays LAST; it owns the 6-arg _settle_match.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.league_divisions (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues(id) on delete cascade,
  name          text not null,
  belt_min      public.belt_rank,
  belt_max      public.belt_rank,
  age_min       int,
  age_max       int,
  weight_min_kg numeric,
  weight_max_kg numeric,
  weight_unit   text not null default 'lbs' check (weight_unit in ('lbs','kg')),
  rating_min    int,
  rating_max    int,
  gender        text not null default 'any'  check (gender in ('any','male','female')),
  ruleset       text not null default 'any'  check (ruleset in ('gi','nogi','any')),
  open          boolean not null default false,
  -- NO `format` column: a league division is inherently the weekly circle method.
  -- Optional per-division scoring override; NULL = inherit the league's scheme.
  win_points      int,
  draw_points     int,
  loss_points     int,
  sub_kill_bonus  int,
  sub_break_bonus int,
  status        text not null default 'setup' check (status in ('setup','running','complete')),
  created_at    timestamptz not null default now()
);

create table if not exists public.league_division_entrants (
  division_id uuid not null references public.league_divisions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  joined_week int  not null default 1,
  joined_at   timestamptz not null default now(),
  primary key (division_id, user_id)
);

-- Fixtures + matches carry the division so pairing/standings scope to it.
-- (The existing unique (league_id, week_no, player_a) still holds: a user
-- registers into exactly one division per league, so plays once per week.)
alter table public.league_fixtures add column if not exists division_id uuid references public.league_divisions(id) on delete cascade;
alter table public.matches         add column if not exists league_division_id uuid references public.league_divisions(id) on delete set null;

create index if not exists idx_league_divisions_league   on public.league_divisions (league_id);
create index if not exists idx_ld_entrants_division       on public.league_division_entrants (division_id);
create index if not exists idx_league_fixtures_division   on public.league_fixtures (division_id) where division_id is not null;
create index if not exists idx_matches_league_division    on public.matches (league_division_id) where league_division_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: rows are world-readable to authed users; writes go through the SECURITY
-- DEFINER RPCs below (organizer-gated), mirroring league_members.
-- ---------------------------------------------------------------------------
alter table public.league_divisions        enable row level security;
alter table public.league_division_entrants enable row level security;

drop policy if exists "league_divisions_read" on public.league_divisions;
create policy "league_divisions_read" on public.league_divisions for select to authenticated using (true);
drop policy if exists "ld_entrants_read" on public.league_division_entrants;
create policy "ld_entrants_read" on public.league_division_entrants for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- is_league_organizer - small helper (no equivalent existed; leagues.sql checks
-- created_by inline). Used by the RPCs below.
-- ---------------------------------------------------------------------------
create or replace function public.is_league_organizer(p_league uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leagues where id = p_league and created_by = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- create_league_division - organizer only. Mirrors create_division minus the
-- bracket `format` (leagues are weekly round-robin) plus optional per-division
-- scoring overrides. Weight bounds are stored canonically in kg.
-- ---------------------------------------------------------------------------
create or replace function public.create_league_division(
  p_league uuid, p_name text,
  p_belt_min public.belt_rank default null, p_belt_max public.belt_rank default null,
  p_age_min int default null, p_age_max int default null,
  p_wmin_kg numeric default null, p_wmax_kg numeric default null,
  p_weight_unit text default 'lbs',
  p_rating_min int default null, p_rating_max int default null,
  p_gender text default 'any', p_open boolean default false, p_ruleset text default 'any',
  p_win_points int default null, p_draw_points int default null, p_loss_points int default null,
  p_sub_kill_bonus int default null, p_sub_break_bonus int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  if not public.is_league_organizer(p_league) then raise exception 'Only the organizer can add divisions'; end if;
  insert into public.league_divisions
    (league_id, name, belt_min, belt_max, age_min, age_max, weight_min_kg, weight_max_kg,
     weight_unit, rating_min, rating_max, gender, open, ruleset,
     win_points, draw_points, loss_points, sub_kill_bonus, sub_break_bonus)
  values
    (p_league, p_name, p_belt_min, p_belt_max, p_age_min, p_age_max, p_wmin_kg, p_wmax_kg,
     coalesce(p_weight_unit,'lbs'), p_rating_min, p_rating_max, coalesce(p_gender,'any'),
     coalesce(p_open,false), coalesce(p_ruleset,'any'),
     p_win_points, p_draw_points, p_loss_points, p_sub_kill_bonus, p_sub_break_bonus)
  returning id into did;
  return did;
end; $$;

-- ---------------------------------------------------------------------------
-- delete_league_division / remove_league_division_entrant - organizer only.
-- ---------------------------------------------------------------------------
create or replace function public.delete_league_division(p_division uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select league_id into lid from public.league_divisions where id = p_division;
  if lid is null then raise exception 'Division not found'; end if;
  if not public.is_league_organizer(lid) then raise exception 'Only the organizer can delete a division'; end if;
  delete from public.league_divisions where id = p_division;
end; $$;

create or replace function public.remove_league_division_entrant(p_division uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select league_id into lid from public.league_divisions where id = p_division;
  if lid is null then raise exception 'Division not found'; end if;
  if not public.is_league_organizer(lid) then raise exception 'Only the organizer can remove entrants'; end if;
  delete from public.league_division_entrants where division_id = p_division and user_id = p_user;
end; $$;

-- ---------------------------------------------------------------------------
-- league_divisions_list - full rows + entrant counts, for the organizer builder
-- and anyone browsing the league. Readable by any authed user.
-- ---------------------------------------------------------------------------
create or replace function public.league_divisions_list(p_league uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',            d.id,
      'name',          d.name,
      'ruleset',       d.ruleset,
      'belt_min',      d.belt_min,
      'belt_max',      d.belt_max,
      'age_min',       d.age_min,
      'age_max',       d.age_max,
      'weight_min_kg', d.weight_min_kg,
      'weight_max_kg', d.weight_max_kg,
      'weight_unit',   d.weight_unit,
      'rating_min',    d.rating_min,
      'rating_max',    d.rating_max,
      'gender',        d.gender,
      'open',          d.open,
      'status',        d.status,
      'win_points',      d.win_points,
      'draw_points',     d.draw_points,
      'loss_points',     d.loss_points,
      'sub_kill_bonus',  d.sub_kill_bonus,
      'sub_break_bonus', d.sub_break_bonus,
      'entrant_count', (select count(*)::int from public.league_division_entrants e where e.division_id = d.id)
    ) order by d.created_at
  ), '[]'::jsonb)
  from public.league_divisions d
  where d.league_id = p_league;
$$;

-- ---------------------------------------------------------------------------
-- _league_division_eligibility - internal wrapper. Loads the division row +
-- "already registered" flag, delegates the belt/age/weight/rating/gender math
-- to the SHARED _eligibility_check core, and appends the row-shaped keys so the
-- returned shape matches tournaments' eligible_divisions element exactly.
-- ---------------------------------------------------------------------------
create or replace function public._league_division_eligibility(p_division uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.league_divisions; core jsonb; alreadyf boolean;
begin
  select * into d from public.league_divisions where id = p_division;
  if not found then return null; end if;
  alreadyf := exists (
    select 1 from public.league_division_entrants
    where division_id = p_division and user_id = p_user
  );
  core := public._eligibility_check(
    p_user, d.open, d.belt_min, d.belt_max, d.age_min, d.age_max,
    d.weight_min_kg, d.weight_max_kg, d.rating_min, d.rating_max, d.gender
  );
  return core || jsonb_build_object(
    'division_id', d.id, 'name', d.name, 'gender', d.gender,
    'weight_unit', d.weight_unit, 'open', d.open, 'already', alreadyf
  );
end; $$;

-- ---------------------------------------------------------------------------
-- eligible_league_divisions - array of eligibility results for the caller.
-- ---------------------------------------------------------------------------
create or replace function public.eligible_league_divisions(p_league uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(public._league_division_eligibility(d.id, auth.uid()) order by d.created_at),
    '[]'::jsonb
  )
  from public.league_divisions d
  where d.league_id = p_league;
$$;

-- ---------------------------------------------------------------------------
-- register_league_division - self-registration. Fills a just-entered weight
-- (pounds) and/or gender onto the profile ONLY when currently null, re-checks
-- eligibility, and on a pass inserts into league_division_entrants AND
-- league_members (so registering into a division joins the league). Open
-- divisions always pass. Mirrors register_division.
-- ---------------------------------------------------------------------------
create or replace function public.register_league_division(
  p_division uuid, p_weight_lbs numeric default null, p_gender text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  d    public.league_divisions;
  wk   int;
  ev   jsonb;
  note text;
begin
  select * into d from public.league_divisions where id = p_division;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  wk := public.current_league_week(d.league_id);

  -- Fill in missing profile data only (never overwrite an existing value with null).
  if p_weight_lbs is not null then
    update public.profiles set weight_lbs = p_weight_lbs where id = uid and weight_lbs is null;
  end if;
  if p_gender is not null and p_gender in ('male','female') then
    update public.profiles set gender = p_gender where id = uid and gender is null;
  end if;

  -- Already registered in THIS division? (idempotent success)
  if exists (select 1 from public.league_division_entrants where division_id = p_division and user_id = uid) then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;

  -- One division per league: the league_fixtures unique(league_id, week_no,
  -- player_a) assumes a member appears in exactly one division, so reject a
  -- second. (A member can still be in different divisions across DIFFERENT
  -- leagues; Gi+No-Gi within ONE league is a future, fixtures-division-aware feature.)
  if exists (
    select 1 from public.league_division_entrants e
    join public.league_divisions ld on ld.id = e.division_id
    where ld.league_id = d.league_id and e.user_id = uid
  ) then
    return jsonb_build_object('ok', false, 'reason', 'other_division');
  end if;

  -- Open divisions accept anyone; otherwise re-check against the updated profile.
  if not d.open then
    ev   := public._league_division_eligibility(p_division, uid);
    note := ev->>'note';
    if not (ev->>'eligible')::boolean then
      if note in ('missing_weight','missing_gender') then
        return jsonb_build_object('ok', false, 'reason', note);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'ineligible');
    end if;
  end if;

  insert into public.league_division_entrants (division_id, user_id, joined_week)
  values (p_division, uid, wk) on conflict do nothing;
  insert into public.league_members (league_id, user_id, role, joined_week)
  values (d.league_id, uid, 'member', wk)
  on conflict (league_id, user_id) do update set active = true;
  return jsonb_build_object('ok', true, 'reason', 'ok');
end; $$;

-- ---------------------------------------------------------------------------
-- generate_league_division_week - one division's pairings for one week. Circle
-- method over the division roster (members who joined on/before this week),
-- scoped by division_id. Idempotent per (division, week). INTERNAL: called only
-- by the generate_league_week dispatch (not granted to authenticated).
-- ---------------------------------------------------------------------------
create or replace function public.generate_league_division_week(p_division uuid, p_week int)
returns void language plpgsql security definer set search_path = public as $$
declare
  lid uuid; ids uuid[]; rot uuid[]; n int; half int; i int; a uuid; b uuid;
begin
  select league_id into lid from public.league_divisions where id = p_division;
  if lid is null then return; end if;

  if exists (select 1 from public.league_fixtures
             where league_id = lid and division_id = p_division and week_no = p_week) then
    return;  -- already generated for this division/week
  end if;

  -- Only entrants who are STILL active league members (a member who left keeps
  -- their entrant row, but must not keep being paired).
  select array_agg(e.user_id order by e.joined_week, e.user_id) into ids
  from public.league_division_entrants e
  join public.league_members lm on lm.league_id = lid and lm.user_id = e.user_id and lm.active
  where e.division_id = p_division and e.joined_week <= p_week;

  if ids is null or array_length(ids, 1) < 2 then return; end if;

  n := array_length(ids, 1);
  if n % 2 = 1 then ids := ids || array[null::uuid]; n := n + 1; end if;  -- bye placeholder

  -- position 1 fixed; rotate the rest by (p_week-1). NOTE: for a k-player
  -- division the circle method has k-1 unique rounds; once weeks > k-1 the
  -- rotation simply cycles and REMATCHES pairings - the desired behavior for a
  -- weeks-long season, not a bug.
  rot := array[ids[1]];
  for i in 1..(n - 1) loop
    rot := rot || ids[2 + ((i - 1 + (p_week - 1)) % (n - 1))];
  end loop;

  half := n / 2;
  for i in 1..half loop
    a := rot[i];
    b := rot[n + 1 - i];
    if a is null or b is null then
      insert into public.league_fixtures (league_id, division_id, week_no, player_a, player_b)
      values (lid, p_division, p_week, coalesce(a, b), null) on conflict do nothing;
    else
      insert into public.league_fixtures (league_id, division_id, week_no, player_a, player_b)
      values (lid, p_division, p_week, a, b) on conflict do nothing;
    end if;
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- generate_league_week - DISPATCH (owns this function; see ownership note).
-- If the league has any divisions, generate each division's week; otherwise run
-- the legacy single-pool circle method (body preserved verbatim from
-- leagues.sql). Organizer-gated. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.generate_league_week(p_league_id uuid, p_week int)
returns void language plpgsql security definer set search_path = public as $$
declare
  is_org boolean; ids uuid[]; rot uuid[]; n int; half int; i int; a uuid; b uuid;
  div record;
begin
  select (created_by = auth.uid()) into is_org from public.leagues where id = p_league_id;
  if not coalesce(is_org, false) then raise exception 'Only the organizer can generate fixtures'; end if;

  -- Divisions WITH ENTRANTS present -> fan out per division (each idempotent per
  -- div/week). We gate on "has an entrant", not merely "a division row exists",
  -- so creating an empty division never silently strands the legacy pool
  -- mid-season - the pool keeps running until someone actually registers.
  if exists (
    select 1 from public.league_divisions ld
    join public.league_division_entrants e on e.division_id = ld.id
    where ld.league_id = p_league_id
  ) then
    for div in select id from public.league_divisions where league_id = p_league_id loop
      perform public.generate_league_division_week(div.id, p_week);
    end loop;
    return;
  end if;

  -- ---- Legacy single-pool (unchanged from leagues.sql) ----
  if exists (select 1 from public.league_fixtures where league_id = p_league_id and week_no = p_week) then
    return;  -- already generated
  end if;

  select array_agg(user_id order by joined_at) into ids
  from public.league_members
  where league_id = p_league_id and active and joined_week <= p_week;

  if ids is null or array_length(ids, 1) < 2 then return; end if;

  n := array_length(ids, 1);
  if n % 2 = 1 then ids := ids || array[null::uuid]; n := n + 1; end if;  -- bye placeholder

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

-- ---------------------------------------------------------------------------
-- league_division_standings - per-division standings, scored with the
-- division's override points where set, else the league's scheme. Mirrors
-- league_standings but scoped to one division.
-- ---------------------------------------------------------------------------
create or replace function public.league_division_standings(p_division uuid)
returns table (user_id uuid, played int, wins int, losses int, draws int, points int)
language sql stable security definer set search_path = public as $$
  with d as (select * from public.league_divisions where id = p_division),
  l as (select l.* from public.leagues l join d on d.league_id = l.id),
  sc as (
    select
      coalesce(d.win_points,      l.win_points)      as win_points,
      coalesce(d.draw_points,     l.draw_points)     as draw_points,
      coalesce(d.loss_points,     l.loss_points)     as loss_points,
      coalesce(d.sub_kill_bonus,  l.sub_kill_bonus)  as sub_kill_bonus,
      coalesce(d.sub_break_bonus, l.sub_break_bonus) as sub_break_bonus
    from d cross join l
  ),
  mem as (
    select e.user_id from public.league_division_entrants e
    join public.league_members lm
      on lm.league_id = (select league_id from d) and lm.user_id = e.user_id and lm.active
    where e.division_id = p_division
  ),
  mt as (
    select * from public.matches where league_division_id = p_division and status = 'completed'
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
      coalesce(per.win,0)  * sc.win_points  +
      coalesce(per.draw,0) * sc.draw_points +
      coalesce(per.loss,0) * sc.loss_points +
      case when per.won_sub = 'kill'  then sc.sub_kill_bonus
           when per.won_sub = 'break' then sc.sub_break_bonus
           else 0 end
    ), 0)::int as points
  from mem
  cross join sc
  left join per on per.uid = mem.user_id
  group by mem.user_id
  order by points desc, wins desc;
$$;

-- ---------------------------------------------------------------------------
-- Grants (public RPCs to authenticated; internal helpers stay ungranted).
-- ---------------------------------------------------------------------------
grant execute on function public.is_league_organizer(uuid) to authenticated;
grant execute on function public.create_league_division(uuid, text, public.belt_rank, public.belt_rank, int, int, numeric, numeric, text, int, int, text, boolean, text, int, int, int, int, int) to authenticated;
grant execute on function public.delete_league_division(uuid) to authenticated;
grant execute on function public.remove_league_division_entrant(uuid, uuid) to authenticated;
grant execute on function public.league_divisions_list(uuid) to authenticated;
grant execute on function public.eligible_league_divisions(uuid) to authenticated;
grant execute on function public.register_league_division(uuid, numeric, text) to authenticated;
grant execute on function public.league_division_standings(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'league divisions installed' as ok;
