-- ============================================================================
-- Roll for Rating - Tournament DIVISIONS v2 (self-registration + eligibility)
-- Run in the Supabase SQL editor AFTER tournament-divisions.sql. Safe to re-run.
--
-- Adds host-defined rating bounds, an entry weight unit, and an "open" flag to
-- divisions, plus a competitor gender on profiles. Introduces self-registration:
-- a competitor sees which divisions they are eligible for (belt / age / weight /
-- rating / gender under directional age flex) and registers themselves.
--
-- *** OWNERSHIP NOTE ***
-- THIS FILE OWNS public.create_division. It SUPERSEDES the older signature in
-- tournament-divisions.sql:
--     create_division(uuid, text, belt_rank, belt_rank, int, int,
--                     numeric, numeric, text, text)                 -- 10 args
-- by adding rating_min / rating_max / weight_unit / open parameters. Because the
-- older version defaults args 3..10, a 2-arg call would match BOTH definitions
-- and PostgreSQL would raise "function is not unique". We therefore DROP the old
-- signature first, then create the new one. Always run this file AFTER
-- tournament-divisions.sql so the drop targets the real old function.
--
-- BELT ORDERING CAVEAT: belt_rank is a Postgres enum. Range checks use its
-- natural ordinal order. The adult belts were defined first
--   (white < blue < purple < brown < black)
-- and youth-belts.sql APPENDS the kids' colors to the END of the enum, so
--   ... < black < gray_white < gray < ... < green < green_black.
-- Adult belt ranges compare correctly. Youth belts all sort ABOVE black, so a
-- host building a KIDS division must set belt_min/belt_max within the youth
-- colors (e.g. gray_white .. green_black); mixing an adult bound with a youth
-- bound will not behave intuitively. This matches the contract requirement to
-- use the enum's natural order for min/max comparison.
--
-- PROD RE-RUN ORDER (idempotent):
--   schema.sql -> ... -> youth-belts.sql -> age-weight.sql -> minors.sql ->
--   tournaments-pro.sql -> tournament-divisions.sql -> tournament-divisions-v2.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

-- profiles.gender: self-reported competitor gender (nullable; existing rows stay null)
alter table public.profiles add column if not exists gender text;
do $$ begin
  alter table public.profiles
    add constraint profiles_gender_chk check (gender is null or gender in ('male','female'));
exception when duplicate_object then null; end $$;
-- Members may set their own gender (own-row update policy already exists).
grant update (gender) on public.profiles to authenticated;

-- tournament_divisions: rating bounds, the unit the host entered weight in
-- (bounds themselves are always stored canonically in kg), and an open flag.
alter table public.tournament_divisions add column if not exists rating_min  int;
alter table public.tournament_divisions add column if not exists rating_max  int;
alter table public.tournament_divisions add column if not exists weight_unit text not null default 'lbs';
alter table public.tournament_divisions add column if not exists open        boolean not null default false;
-- Ruleset (Gi vs No-Gi): a first-class bracket-separating dimension. It is NOT
-- an eligibility axis (any athlete may enter both a Gi and a No-Gi division as
-- separate registrations); it separates brackets and, later, weight tables
-- (no-gi limits run ~2 kg lighter). 'any' = the event does not split by ruleset.
alter table public.tournament_divisions add column if not exists ruleset     text not null default 'any';
do $$ begin
  alter table public.tournament_divisions
    add constraint tdiv_weight_unit_chk check (weight_unit in ('lbs','kg'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tournament_divisions
    add constraint tdiv_ruleset_chk check (ruleset in ('gi','nogi','any'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- create_division - NEW signature (owns this function; see ownership note above)
-- ---------------------------------------------------------------------------
-- Drop both prior signatures so a defaulted call can never be ambiguous:
-- the original 10-arg (tournament-divisions.sql) and the 14-arg v2 (pre-ruleset).
drop function if exists public.create_division(uuid, text, public.belt_rank, public.belt_rank, int, int, numeric, numeric, text, text);
drop function if exists public.create_division(uuid, text, public.belt_rank, public.belt_rank, int, int, numeric, numeric, text, int, int, text, text, boolean);

create or replace function public.create_division(
  p_tid uuid, p_name text,
  p_belt_min public.belt_rank default null, p_belt_max public.belt_rank default null,
  p_age_min int default null, p_age_max int default null,
  p_wmin_kg numeric default null, p_wmax_kg numeric default null,
  p_weight_unit text default 'lbs',
  p_rating_min int default null, p_rating_max int default null,
  p_gender text default 'any', p_format text default null,
  p_open boolean default false, p_ruleset text default 'any'
) returns uuid language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can add divisions'; end if;
  insert into public.tournament_divisions
    (tournament_id, name, belt_min, belt_max, age_min, age_max,
     weight_min_kg, weight_max_kg, weight_unit, rating_min, rating_max, gender, format, open, ruleset)
  values
    (p_tid, p_name, p_belt_min, p_belt_max, p_age_min, p_age_max,
     p_wmin_kg, p_wmax_kg, coalesce(p_weight_unit,'lbs'), p_rating_min, p_rating_max,
     coalesce(p_gender,'any'), p_format, coalesce(p_open,false), coalesce(p_ruleset,'any'))
  returning id into did;
  return did;
end; $$;

-- ---------------------------------------------------------------------------
-- delete_division - host only (cascades entrants/teams/bouts)
-- ---------------------------------------------------------------------------
create or replace function public.delete_division(p_division uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if tid is null then raise exception 'Division not found'; end if;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can delete a division'; end if;
  delete from public.tournament_divisions where id = p_division;
end; $$;

-- ---------------------------------------------------------------------------
-- remove_division_entrant - host only; drops the division registration but
-- leaves the athlete in tournament_entrants.
-- ---------------------------------------------------------------------------
create or replace function public.remove_division_entrant(p_division uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if tid is null then raise exception 'Division not found'; end if;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can remove entrants'; end if;
  delete from public.division_entrants where division_id = p_division and user_id = p_user;
end; $$;

-- ---------------------------------------------------------------------------
-- tournament_divisions_list - full division rows + entrant counts, for the
-- host builder and anyone browsing the event. Readable by any authed user.
-- ---------------------------------------------------------------------------
create or replace function public.tournament_divisions_list(p_tid uuid)
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
      'format',        d.format,
      'open',          d.open,
      'status',        d.status,
      'entrant_count', (select count(*)::int from public.division_entrants de where de.division_id = d.id)
    ) order by d.created_at
  ), '[]'::jsonb)
  from public.tournament_divisions d
  where d.tournament_id = p_tid;
$$;

-- ---------------------------------------------------------------------------
-- _division_eligibility - internal: compute one division's eligibility for one
-- user. Returns the eligible_divisions element shape. NOT granted to
-- authenticated (called only by definer functions below), matching the other
-- internal helpers in tournament-divisions.sql.
--
-- Axis rules (each fit=true if the axis passes OR is unconstrained):
--   belt   : belt_min <= belt_rank <= belt_max (enum ordinal order; nulls open)
--   age    : full years from birthdate. Below age_min is ALWAYS allowed
--            (youth move_up). Above age_max allowed ONLY for an adult division
--            (age_min null or >= 18) => move_down. Constrained + no birthdate
--            => fails. Both bounds null => unconstrained.
--   weight : caller weight_lbs -> kg, within [weight_min_kg, weight_max_kg].
--            Constrained + null weight => fails (note missing_weight).
--   rating : rating within [rating_min, rating_max]; both null => unconstrained.
--   gender : division 'male'/'female' must equal caller gender.
--            Constrained + null gender => fails (note missing_gender).
-- eligible = open OR (belt && age && weight && rating && gender).
-- note precedence when NOT eligible: missing_weight, then missing_gender, else
-- ineligible - so the UI can prompt for the missing datum.
-- ---------------------------------------------------------------------------
create or replace function public._division_eligibility(p_division uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d              public.tournament_divisions;
  pr             public.profiles;
  a              int;
  wkg            numeric;
  is_adult_div   boolean;
  belt_fit       boolean;
  age_fit        boolean;
  weight_fit     boolean;
  rating_fit     boolean;
  gender_fit     boolean;
  age_note       text := 'ok';
  wt_constrained boolean;
  gd_constrained boolean;
  alreadyf       boolean;
  elig           boolean;
  note           text;
begin
  select * into d from public.tournament_divisions where id = p_division;
  if not found then return null; end if;
  select * into pr from public.profiles where id = p_user;

  alreadyf := exists (
    select 1 from public.division_entrants
    where division_id = p_division and user_id = p_user
  );

  -- OPEN short-circuits: ignore every filter, anyone may register.
  if d.open then
    return jsonb_build_object(
      'division_id', d.id, 'name', d.name, 'gender', d.gender,
      'weight_unit', d.weight_unit, 'open', true,
      'eligible', true, 'already', alreadyf, 'note', 'open',
      'fit', jsonb_build_object('belt',true,'age',true,'weight',true,'rating',true,'gender',true)
    );
  end if;

  -- BELT (enum natural/ordinal order; null bound = unbounded)
  belt_fit := (d.belt_min is null or pr.belt_rank >= d.belt_min)
          and (d.belt_max is null or pr.belt_rank <= d.belt_max);

  -- AGE (directional flex)
  if d.age_min is null and d.age_max is null then
    age_fit := true;
  elsif pr.birthdate is null then
    age_fit := false;
  else
    a := extract(year from age(current_date, pr.birthdate))::int;
    is_adult_div := (d.age_min is null or d.age_min >= 18);
    if (d.age_max is null or a <= d.age_max) then
      -- at/below the max; being below the min is an allowed youth move-up.
      age_fit := true;
      if d.age_min is not null and a < d.age_min then age_note := 'move_up'; end if;
    elsif is_adult_div then
      -- above the max, but an adult bracket accepts a masters drop-down.
      age_fit := true;
      age_note := 'move_down';
    else
      age_fit := false;
    end if;
  end if;

  -- WEIGHT (canonical kg; caller weight is pounds -> convert)
  wt_constrained := (d.weight_min_kg is not null or d.weight_max_kg is not null);
  if not wt_constrained then
    weight_fit := true;
  elsif pr.weight_lbs is null then
    weight_fit := false;
  else
    wkg := pr.weight_lbs * 0.45359237;
    weight_fit := (d.weight_min_kg is null or wkg >= d.weight_min_kg)
              and (d.weight_max_kg is null or wkg <= d.weight_max_kg);
  end if;

  -- RATING
  if d.rating_min is null and d.rating_max is null then
    rating_fit := true;
  else
    rating_fit := (d.rating_min is null or pr.rating >= d.rating_min)
              and (d.rating_max is null or pr.rating <= d.rating_max);
  end if;

  -- GENDER
  gd_constrained := (d.gender in ('male','female'));
  if not gd_constrained then
    gender_fit := true;
  elsif pr.gender is null then
    gender_fit := false;
  else
    gender_fit := (pr.gender = d.gender);
  end if;

  elig := belt_fit and age_fit and weight_fit and rating_fit and gender_fit;

  if elig then
    note := age_note;                         -- 'ok' / 'move_up' / 'move_down'
  elsif wt_constrained and pr.weight_lbs is null then
    note := 'missing_weight';
  elsif gd_constrained and pr.gender is null then
    note := 'missing_gender';
  else
    note := 'ineligible';
  end if;

  return jsonb_build_object(
    'division_id', d.id, 'name', d.name, 'gender', d.gender,
    'weight_unit', d.weight_unit, 'open', false,
    'eligible', elig, 'already', alreadyf, 'note', note,
    'fit', jsonb_build_object(
      'belt', belt_fit, 'age', age_fit, 'weight', weight_fit,
      'rating', rating_fit, 'gender', gender_fit
    )
  );
end; $$;

-- ---------------------------------------------------------------------------
-- eligible_divisions - array of eligibility results for the calling user.
-- ---------------------------------------------------------------------------
create or replace function public.eligible_divisions(p_tid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(public._division_eligibility(d.id, auth.uid()) order by d.created_at),
    '[]'::jsonb
  )
  from public.tournament_divisions d
  where d.tournament_id = p_tid;
$$;

-- ---------------------------------------------------------------------------
-- register_division - self-registration. Optionally persists a just-entered
-- weight (pounds) and/or gender to the caller's profile WHEN currently null
-- (never null-overwrites), re-checks eligibility with the updated data, and on
-- a pass inserts into division_entrants + tournament_entrants. Open divisions
-- always pass.
-- ---------------------------------------------------------------------------
create or replace function public.register_division(
  p_division uuid, p_weight_lbs numeric default null, p_gender text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  d    public.tournament_divisions;
  ev   jsonb;
  note text;
begin
  select * into d from public.tournament_divisions where id = p_division;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Fill in missing profile data only (never overwrite an existing value with null).
  if p_weight_lbs is not null then
    update public.profiles set weight_lbs = p_weight_lbs where id = uid and weight_lbs is null;
  end if;
  if p_gender is not null and p_gender in ('male','female') then
    update public.profiles set gender = p_gender where id = uid and gender is null;
  end if;

  -- Already registered? (idempotent success)
  if exists (select 1 from public.division_entrants where division_id = p_division and user_id = uid) then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;

  -- Open divisions accept anyone.
  if d.open then
    insert into public.division_entrants (division_id, user_id) values (p_division, uid) on conflict do nothing;
    insert into public.tournament_entrants (tournament_id, user_id) values (d.tournament_id, uid) on conflict do nothing;
    return jsonb_build_object('ok', true, 'reason', 'ok');
  end if;

  -- Re-check eligibility against the (possibly just-updated) profile.
  ev   := public._division_eligibility(p_division, uid);
  note := ev->>'note';
  if (ev->>'eligible')::boolean then
    insert into public.division_entrants (division_id, user_id) values (p_division, uid) on conflict do nothing;
    insert into public.tournament_entrants (tournament_id, user_id) values (d.tournament_id, uid) on conflict do nothing;
    return jsonb_build_object('ok', true, 'reason', 'ok');
  end if;

  if note in ('missing_weight','missing_gender') then
    return jsonb_build_object('ok', false, 'reason', note);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'ineligible');
end; $$;

-- ---------------------------------------------------------------------------
-- Grants (execute to authenticated for the public RPCs; the internal
-- _division_eligibility helper stays ungranted, called via definer privilege).
-- ---------------------------------------------------------------------------
grant execute on function public.create_division(uuid, text, public.belt_rank, public.belt_rank, int, int, numeric, numeric, text, int, int, text, text, boolean, text) to authenticated;
grant execute on function public.delete_division(uuid) to authenticated;
grant execute on function public.remove_division_entrant(uuid, uuid) to authenticated;
grant execute on function public.tournament_divisions_list(uuid) to authenticated;
grant execute on function public.eligible_divisions(uuid) to authenticated;
grant execute on function public.register_division(uuid, numeric, text) to authenticated;

select 'tournament divisions v2 installed' as ok;
