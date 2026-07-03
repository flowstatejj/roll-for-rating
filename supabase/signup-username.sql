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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base  text;
  uname text;
  n     int := 0;
begin
  base := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
                   'user_' || left(new.id::text, 8));
  uname := base;
  -- Never raise on a duplicate username (GoTrue would show the opaque
  -- "Database error saving new user"); append a suffix until it's unique.
  while exists (select 1 from public.profiles where username = uname) loop
    n := n + 1;
    uname := base || n::text;
  end loop;

  insert into public.profiles (id, username, display_name, belt_rank)
  values (
    new.id,
    uname,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username', 'New Grappler'),
    coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white')
  );
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
