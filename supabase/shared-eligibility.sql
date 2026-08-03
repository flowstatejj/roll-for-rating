-- *** RE-RUN WARNING (added 2026-07-20 audit) ***
-- This file (re)defines public.handle_new_user, the signup trigger. So do
-- schema.sql, minors.sql, family-plan.sql, belt-starting-rating.sql,
-- shared-eligibility.sql, tournament-guests.sql and signup-username.sql.
-- The AUTHORITATIVE version is supabase/signup-trigger-consolidated.sql
-- (it adds the concurrency retry + guards). Last one applied wins, so
-- ALWAYS re-run signup-trigger-consolidated.sql after this file, or new
-- signups silently regress to an older trigger. A partial version of this
-- exact mechanism caused the July signup outage.
-- ============================================================================
-- Roll for Rating - SHARED eligibility core (entity-agnostic)
-- Run in the Supabase SQL editor AFTER youth-belts.sql / age-weight.sql /
-- minors.sql and BEFORE tournament-divisions-v2.sql and league-divisions.sql.
-- Safe to re-run.
--
-- WHY THIS FILE EXISTS
-- The belt / age / weight / rating / gender eligibility math (with directional
-- age flex) was born inside tournament _division_eligibility. Leagues now need
-- the exact same rules. Rather than copy-paste it (the drift trap that produced
-- 5 copies of handle_new_user), the pure math lives HERE once, taking range
-- params + a user id and knowing nothing about tournaments or leagues. Both
-- entities' eligibility wrappers call it and only add their own row-shaped keys.
--
-- CONTRACT (identical to the original tournament logic):
--   belt   : belt_min <= profile.belt_rank <= belt_max (enum ordinal order;
--            null bound = unbounded). Belt enum has adult colors first then
--            youth appended above black, so a youth division must bound within
--            the youth colors (see tournament-divisions-v2.sql belt caveat).
--   age    : full years from birthdate. Below age_min is ALWAYS allowed
--            (youth move_up). Above age_max allowed ONLY for an adult division
--            (age_min null or >= 18) => move_down. Constrained + no birthdate
--            => fails. Both bounds null => unconstrained.
--   weight : profile.weight_lbs -> kg, within [weight_min_kg, weight_max_kg].
--            Constrained + null weight => fails (note missing_weight).
--   rating : profile.rating within [rating_min, rating_max]; both null => open.
--   gender : p_gender 'male'/'female' must equal profile.gender.
--            Constrained + null gender => fails (note missing_gender).
-- eligible = p_open OR (belt && age && weight && rating && gender).
-- note precedence when NOT eligible: missing_weight, then missing_gender, else
-- ineligible. When eligible: 'ok' / 'move_up' / 'move_down' (or 'open').
--
-- RETURNS the entity-neutral core only:
--   { eligible, note, fit:{belt,age,weight,rating,gender} }
-- Wrappers append division_id/name/gender/weight_unit/open/already themselves so
-- the public JSON shape consumed by the app is unchanged.
-- ============================================================================

create or replace function public._eligibility_check(
  p_user          uuid,
  p_open          boolean,
  p_belt_min      public.belt_rank,
  p_belt_max      public.belt_rank,
  p_age_min       int,
  p_age_max       int,
  p_weight_min_kg numeric,
  p_weight_max_kg numeric,
  p_rating_min    int,
  p_rating_max    int,
  p_gender        text          -- 'any' | 'male' | 'female'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
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
  elig           boolean;
  note           text;
begin
  -- OPEN short-circuits: ignore every filter, anyone may register.
  if coalesce(p_open, false) then
    return jsonb_build_object(
      'eligible', true, 'note', 'open',
      'fit', jsonb_build_object('belt',true,'age',true,'weight',true,'rating',true,'gender',true)
    );
  end if;

  select * into pr from public.profiles where id = p_user;
  if not found then
    -- No profile: nothing can be evaluated; treat as ineligible on every axis.
    return jsonb_build_object(
      'eligible', false, 'note', 'ineligible',
      'fit', jsonb_build_object('belt',false,'age',false,'weight',false,'rating',false,'gender',false)
    );
  end if;

  -- BELT (enum natural/ordinal order; null bound = unbounded)
  belt_fit := (p_belt_min is null or pr.belt_rank >= p_belt_min)
          and (p_belt_max is null or pr.belt_rank <= p_belt_max);

  -- AGE (directional flex)
  if p_age_min is null and p_age_max is null then
    age_fit := true;
  elsif pr.birthdate is null then
    age_fit := false;
  else
    a := extract(year from age(current_date, pr.birthdate))::int;
    is_adult_div := (p_age_min is null or p_age_min >= 18);
    if (p_age_max is null or a <= p_age_max) then
      -- at/below the max; being below the min is an allowed youth move-up.
      age_fit := true;
      if p_age_min is not null and a < p_age_min then age_note := 'move_up'; end if;
    elsif is_adult_div then
      -- above the max, but an adult bracket accepts a masters drop-down.
      age_fit := true;
      age_note := 'move_down';
    else
      age_fit := false;
    end if;
  end if;

  -- WEIGHT (canonical kg; caller weight is pounds -> convert)
  wt_constrained := (p_weight_min_kg is not null or p_weight_max_kg is not null);
  if not wt_constrained then
    weight_fit := true;
  elsif pr.weight_lbs is null then
    weight_fit := false;
  else
    wkg := pr.weight_lbs * 0.45359237;
    weight_fit := (p_weight_min_kg is null or wkg >= p_weight_min_kg)
              and (p_weight_max_kg is null or wkg <= p_weight_max_kg);
  end if;

  -- RATING
  if p_rating_min is null and p_rating_max is null then
    rating_fit := true;
  else
    rating_fit := (p_rating_min is null or pr.rating >= p_rating_min)
              and (p_rating_max is null or pr.rating <= p_rating_max);
  end if;

  -- GENDER
  gd_constrained := (p_gender in ('male','female'));
  if not gd_constrained then
    gender_fit := true;
  elsif pr.gender is null then
    gender_fit := false;
  else
    gender_fit := (pr.gender = p_gender);
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
    'eligible', elig, 'note', note,
    'fit', jsonb_build_object(
      'belt', belt_fit, 'age', age_fit, 'weight', weight_fit,
      'rating', rating_fit, 'gender', gender_fit
    )
  );
end; $$;

select 'shared eligibility core installed' as ok;
