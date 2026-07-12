-- ============================================================================
-- Roll for Rating - CONSOLIDATED signup trigger
--
-- ############################################################################
-- ##  THIS FILE OWNS handle_new_user.                                       ##
-- ##  If you edit or RE-RUN any of the older files listed below, you MUST   ##
-- ##  re-run THIS file afterwards. Each of them also does                   ##
-- ##  "create or replace function public.handle_new_user()" and whichever   ##
-- ##  file ran LAST on prod silently wins (this drift already broke         ##
-- ##  signups once - see below).                                            ##
-- ##                                                                        ##
-- ##    supabase/schema.sql                (base profile insert only)       ##
-- ##    supabase/minors.sql                (+ birthdate, parent consent)    ##
-- ##    supabase/belt-starting-rating.sql  (+ belt-based starting rating)   ##
-- ##    supabase/family-plan.sql           (+ participating flag)           ##
-- ##    supabase/signup-username.sql       (+ case-insensitive uniquify)    ##
-- ############################################################################
--
-- Why this file exists (the 2026-07 Android signup outage):
--   * Jul 3: signup-username.sql ran on prod (adds the username uniquify loop
--     so a duplicate username can NEVER raise inside the auth transaction).
--   * Jul 4: family-plan.sql / belt-starting-rating.sql / youth-belts.sql ran
--     on prod. Their handle_new_user versions have NO uniquify loop, so the
--     Jul 3 fix was silently overwritten by whichever ran last.
--   * Jul 9: username-unique-ci.sql created the unique index
--     idx_profiles_username_ci on lower(username). From that moment ANY
--     case-insensitive username collision raises a unique violation INSIDE
--     GoTrue's signup transaction; GoTrue rolls the whole signup back and the
--     app surfaces an opaque "Database error saving new user" style failure.
--
-- This file restores the UNION of every behavior the drifted versions had:
--   * case-insensitive username uniquify with numeric suffixes (never raise),
--     plus a concurrency safety net (retry once on a unique-violation race)
--   * belt-based starting rating via public.starting_rating (incl. youth belts)
--   * birthdate from signup metadata (age_tier / is_minor / consent_status are
--     then computed by the trg_minor_profile trigger on profiles)
--   * participating flag (false for guardian accounts)
--   * parent_consents seeding for a self-registered minor with a parent email
--
-- Idempotent / safe to re-run at any time.
-- Fresh-database run order: schema.sql, minors.sql, challenges.sql,
-- youth-belts.sql, belt-starting-rating.sql, subscriptions.sql,
-- managed-juniors.sql, family-plan.sql, username-unique-ci.sql, THEN this
-- file. The guards below fail loudly (not silently) if a prerequisite is
-- missing.
-- ============================================================================

-- --- 0. Prerequisite guards --------------------------------------------------
-- Fail with an actionable message instead of installing a trigger that would
-- blow up at the first signup.
do $$
declare
  missing text := '';
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'starting_rating'
  ) then
    missing := missing || ' [starting_rating -> run belt-starting-rating.sql]';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tier_for'
  ) then
    missing := missing || ' [tier_for -> run minors.sql]';
  end if;

  if to_regclass('public.parent_consents') is null then
    missing := missing || ' [parent_consents -> run minors.sql]';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'birthdate'
  ) then
    missing := missing || ' [profiles.birthdate -> run minors.sql]';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'participating'
  ) then
    missing := missing || ' [profiles.participating -> run family-plan.sql]';
  end if;

  if missing <> '' then
    raise exception 'signup-trigger-consolidated: prerequisites missing:%', missing;
  end if;
end $$;

-- --- 1. The one true handle_new_user -----------------------------------------
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
  v_name text      := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
                               base, 'New Grappler');
begin
  -- Never raise on a duplicate username (GoTrue would surface the opaque
  -- "Database error saving new user" and roll the whole signup back).
  -- Case-insensitive to match idx_profiles_username_ci on lower(username);
  -- append a numeric suffix until the name is free.
  while exists (select 1 from public.profiles where lower(username) = lower(uname)) loop
    n := n + 1;
    uname := base || n::text;
  end loop;

  begin
    insert into public.profiles (id, username, display_name, belt_rank, rating, birthdate, participating)
    values (
      new.id,
      uname,
      v_name,
      v_belt,
      public.starting_rating(v_belt),
      bd,
      v_part
    );
  exception when unique_violation then
    -- Concurrency safety net: another signup grabbed this username between
    -- the check loop above and our insert. Retry once with a random suffix;
    -- if THAT also fails (or the violation was something else entirely, e.g.
    -- the primary key), the second insert re-raises as before.
    uname := base || '_' || substr(md5(random()::text), 1, 4);
    insert into public.profiles (id, username, display_name, belt_rank, rating, birthdate, participating)
    values (
      new.id,
      uname,
      v_name,
      v_belt,
      public.starting_rating(v_belt),
      bd,
      v_part
    );
  end;

  -- Self-registered minor (teen) with a parent email: seed the consent row.
  -- (The trg_minor_profile trigger on profiles fills in age_tier / is_minor /
  -- consent_status from birthdate.)
  if public.tier_for(bd) <> 'adult'
     and nullif(new.raw_user_meta_data ->> 'parent_email', '') is not null then
    insert into public.parent_consents (user_id, parent_email)
    values (new.id, new.raw_user_meta_data ->> 'parent_email')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- --- 2. Make sure the trigger itself exists and points at the function -------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- 3. username_available RPC (the signup screen's friendly pre-check) ------
-- Re-asserted here because the client's "Username taken" pre-check depends on
-- it; identical to the signup-username.sql definition. Case-insensitive,
-- trimmed, callable by anon.
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(btrim(p_username))
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Refresh PostgREST so the RPC is callable immediately.
notify pgrst, 'reload schema';

select 'signup trigger consolidated' as ok;
