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
-- Roll for Rating — robust signup usernames (audit Tier 0)
-- Run after schema.sql (redefines handle_new_user). Safe to re-run.
--
-- Problem: handle_new_user() inserted the chosen username directly. On a
-- duplicate (profiles.username is UNIQUE) the insert raised INSIDE the auth
-- signup transaction, which GoTrue surfaces to the client only as the opaque
-- "Database error saving new user" — a dead end for a new user, and username is
-- not client-editable afterward.
--
-- Fix: uniquify in the trigger so signup can NEVER hard-fail on a username
-- collision (a numeric suffix is appended on the rare clash). Plus a
-- username_available() RPC the signup screen can call up front (anon-callable)
-- to show a clean "that username is taken" message before submitting.
-- ============================================================================

-- AUTHORITATIVE handle_new_user: this is the single definition that supersedes
-- the ones in schema.sql / belt-starting-rating.sql / minors.sql / family-plan.sql.
-- It unions ALL of their behavior so nothing regresses regardless of run order:
--   * username uniquify (so a collision never surfaces the opaque signup error),
--   * belt-based starting rating,
--   * birthdate + participating,
--   * parent-consent seeding for a self-registered minor.
-- Run this LAST (after minors.sql + family-plan.sql + belt-starting-rating.sql).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base   text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
                          'user_' || left(new.id::text, 8));
  uname  text := base;
  n      int := 0;
  bd     date      := nullif(new.raw_user_meta_data ->> 'birthdate', '')::date;
  v_belt belt_rank := coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white');
  v_part boolean   := coalesce((new.raw_user_meta_data ->> 'participating')::boolean, true);
begin
  -- Never raise on a duplicate username (GoTrue would show the opaque
  -- "Database error saving new user"); append a suffix until it's unique.
  while exists (select 1 from public.profiles where lower(username) = lower(uname)) loop
    n := n + 1;
    uname := base || n::text;
  end loop;

  insert into public.profiles (id, username, display_name, belt_rank, rating, birthdate, participating)
  values (
    new.id,
    uname,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), base, 'New Grappler'),
    v_belt,
    public.starting_rating(v_belt),
    bd,
    v_part
  );

  -- Self-registered minor (teen) with a parent email → seed the consent row.
  -- (A separate profiles trigger fills in age_tier / is_minor / consent_status.)
  if public.tier_for(bd) <> 'adult'
     and nullif(new.raw_user_meta_data ->> 'parent_email', '') is not null then
    insert into public.parent_consents (user_id, parent_email)
    values (new.id, new.raw_user_meta_data ->> 'parent_email')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Is a username free? Callable by anon so the signup screen can pre-check before
-- creating the account (case-insensitive, trimmed).
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(btrim(p_username))
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;
