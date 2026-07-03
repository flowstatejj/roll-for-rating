-- ============================================================================
-- Roll for Rating — hide minor PII from other users (audit Tier 0, #1/#2)
-- Run after schema.sql AND the migrations that add profile columns. Safe to
-- re-run.
--
-- The profiles SELECT policy is `using(true)` — and it must stay that way:
-- leaderboards, opponent picking, gym rosters, and match FK-embeds all read
-- OTHER users' profiles. But `using(true)` also exposed every user's EXACT
-- birthdate (and parent_email, if present) to any authenticated user, which is a
-- minor-privacy problem (a teen's date of birth readable by everyone).
--
-- RLS is row-level, so we restrict the sensitive COLUMNS instead: revoke SELECT
-- on birthdate/parent_email from the `authenticated` role, keeping every other
-- column readable. SECURITY DEFINER functions (age_tier computation, consent,
-- handle_new_user) run as the table owner and still read them, so server-side
-- minor protections are unaffected. The client selects an explicit safe column
-- list (PROFILE_COLS in src/lib/types.ts) instead of `select('*')`.
--
-- The grant list is built dynamically from information_schema so no column is
-- ever missed (and it adapts as columns are added).
-- ============================================================================
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name not in ('birthdate', 'parent_email');

  -- Reset then re-grant only the safe columns.
  execute 'revoke select on public.profiles from authenticated';
  execute format('grant select (%s) on public.profiles to authenticated', cols);
end $$;

-- Let PostgREST see the changed privileges immediately.
notify pgrst, 'reload schema';
