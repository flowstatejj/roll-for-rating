-- ============================================================================
-- Roll for Rating — Under-18 (minor) protections
-- Run in the Supabase SQL Editor (after schema.sql, social.sql, public-matches,
-- challenges). Safe to re-run. Enforced server-side so the app can't bypass it.
-- ============================================================================

alter table public.profiles add column if not exists is_minor boolean not null default false;

-- Seed is_minor from sign-up metadata (extends the existing handle_new_user).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, belt_rank, is_minor)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username', 'New Grappler'),
    coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white'),
    coalesce((new.raw_user_meta_data ->> 'is_minor')::boolean, false)
  );
  return new;
end; $$;

-- The caller's own gym (SECURITY DEFINER so the RLS policy below can't recurse).
create or replace function public.my_gym_id()
returns uuid language sql stable security definer set search_path = public
as $$ select gym_id from public.profiles where id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- A minor's profile is visible only to themselves and same-gym members.
-- (Replaces the old "everyone can read every profile" policy.)
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_read_all" on public.profiles;
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or is_minor = false
    or (gym_id is not null and gym_id = public.my_gym_id())
  );

-- ---------------------------------------------------------------------------
-- Minors can never be "open for a challenge" (force off on any write).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_minor_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_minor then new.open_for_challenge := false; end if;
  return new;
end; $$;
drop trigger if exists trg_minor_profile on public.profiles;
create trigger trg_minor_profile before insert or update on public.profiles
  for each row execute function public.enforce_minor_profile();

-- ---------------------------------------------------------------------------
-- Matches involving a minor: no wager, never public, same-gym only.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_minor_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare cminor boolean; ominor boolean; cgym uuid; ogym uuid; rgym uuid;
begin
  select is_minor, gym_id into cminor, cgym from public.profiles where id = new.challenger_id;
  select is_minor, gym_id into ominor, ogym from public.profiles where id = new.opponent_id;
  select gym_id into rgym from public.profiles where id = new.referee_id;

  if coalesce(cminor, false) or coalesce(ominor, false) then
    new.wager := 0;
    new.is_public := false;
    if cgym is null or cgym <> ogym or cgym <> rgym then
      raise exception 'For safety, matches involving an under-18 member must be between members of the same gym, with a referee from that gym.';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_minor_match on public.matches;
create trigger trg_minor_match before insert on public.matches
  for each row execute function public.enforce_minor_match();
