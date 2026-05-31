-- ============================================================================
-- Roll for Rating — Parent-managed junior (under-14) accounts  [Phase 1]
-- Run AFTER schema.sql, social.sql, and minors.sql. Safe to re-run.
--
-- Under-14 ("kid") accounts are created and operated by a parent/guardian's
-- adult account. The child has NO login of their own; the parent operates the
-- profile from their own session. Consent is inherent (the parent is the
-- account holder). Everything is enforced server-side (RLS + triggers).
--
-- Phase 1 = data model + management (add / edit / delete juniors) + guardrails.
-- Phase 2 (separate) wires juniors into the match flow (create/accept on behalf).
-- ============================================================================

-- --- 1. managed_by column + self-reference -------------------------------
alter table public.profiles add column if not exists managed_by uuid;
do $$ begin
  alter table public.profiles
    add constraint profiles_managed_by_fkey
    foreign key (managed_by) references public.profiles (id) on delete cascade;
exception when duplicate_object then null; end $$;
create index if not exists profiles_managed_by_idx on public.profiles (managed_by);

-- --- 2. Allow profiles WITHOUT an auth user (managed juniors have none) ----
-- Drop the profiles.id -> auth.users FK (its cascade is replaced by a trigger
-- below) and give id a default so guardians can insert a junior row directly.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

-- Preserve "delete the profile when its auth user is deleted" (which then
-- cascades to that user's managed juniors via profiles_managed_by_fkey).
create or replace function public.handle_auth_user_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end; $$;
drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();

-- --- 3. Helper: caller's own age tier (definer, avoids RLS recursion) ------
create or replace function public.my_age_tier()
returns text language sql stable security definer set search_path = public
as $$ select age_tier from public.profiles where id = auth.uid() $$;

-- --- 4. Profile trigger: managed juniors are consent-satisfied ------------
-- (Re-declares enforce_minor_profile from minors.sql, adding the managed case.)
create or replace function public.enforce_minor_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.age_tier := public.tier_for(new.birthdate);
  new.is_minor := new.age_tier <> 'adult';

  if new.managed_by is not null then
    -- A managing parent/guardian provides consent by being the account holder.
    new.consent_status := 'verified';
  elsif tg_op = 'INSERT' then
    if new.is_minor then
      if coalesce(new.consent_status, 'not_required') = 'not_required' then
        new.consent_status := 'pending';
      end if;
    else
      new.consent_status := 'not_required';
    end if;
  else
    if not new.is_minor then
      new.consent_status := 'not_required';
    elsif new.consent_status is null then
      new.consent_status := 'pending';
    end if;
  end if;

  -- Kids and not-yet-verified minors are never "open for a challenge".
  if new.age_tier = 'kid' or (new.is_minor and new.consent_status <> 'verified') then
    new.open_for_challenge := false;
  end if;

  return new;
end; $$;
-- trigger already created by minors.sql; re-create defensively
drop trigger if exists trg_minor_profile on public.profiles;
create trigger trg_minor_profile before insert or update on public.profiles
  for each row execute function public.enforce_minor_profile();

-- --- 5. Match enforcement: + conflict-of-interest rule --------------------
-- (Re-declares enforce_minor_match from minors.sql, adding the referee rule.)
create or replace function public.enforce_minor_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; o record;
begin
  select is_minor, age_tier, consent_status, managed_by into c
    from public.profiles where id = new.challenger_id;
  select is_minor, age_tier, consent_status, managed_by into o
    from public.profiles where id = new.opponent_id;

  -- A minor can't compete until consent is verified (managed juniors are
  -- auto-verified via their guardian).
  if c.is_minor and c.consent_status <> 'verified' then
    raise exception 'This account is pending parental consent and cannot start matches yet.';
  end if;
  if o.is_minor and o.consent_status <> 'verified' then
    raise exception 'That opponent''s account is pending parental consent and cannot be matched yet.';
  end if;

  -- Conflict of interest: a managing parent/guardian may not referee a match
  -- their own (or the opponent's) junior is competing in.
  if new.referee_id = c.managed_by or new.referee_id = o.managed_by then
    raise exception 'A managing parent/guardian cannot referee their own junior''s match. Use a neutral referee.';
  end if;

  -- Wagering is adults-only (teens included).
  if c.is_minor or o.is_minor then
    new.wager := 0;
  end if;

  -- Under-14 (kid): never public, and can only face other minors (never an adult).
  if c.age_tier = 'kid' or o.age_tier = 'kid' then
    new.is_public := false;
    if not (c.is_minor and o.is_minor) then
      raise exception 'Under-14 members can only be matched against other under-18 members.';
    end if;
  end if;

  return new;
end; $$;
drop trigger if exists trg_minor_match on public.matches;
create trigger trg_minor_match before insert on public.matches
  for each row execute function public.enforce_minor_match();

-- --- 6. RLS: guardians can see/create/edit/delete their juniors -----------

-- Read: also allow a guardian to read profiles they manage.
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or age_tier = 'adult'
    or (age_tier = 'teen' and consent_status = 'verified')
    or (gym_id is not null and gym_id = public.my_gym_id())
    or managed_by = auth.uid()
  );

-- Insert: an ADULT may create a managed junior (under-14) pointing at themselves.
-- Only specific columns are insertable (rating/wins/etc. fall back to defaults).
revoke insert on public.profiles from authenticated;
grant insert (username, display_name, belt_rank, birthdate, managed_by, gym_id, city)
  on public.profiles to authenticated;
drop policy if exists "profiles_insert_managed_junior" on public.profiles;
create policy "profiles_insert_managed_junior" on public.profiles
  for insert to authenticated with check (
    managed_by = auth.uid()
    and public.tier_for(birthdate) = 'kid'
    and public.my_age_tier() = 'adult'
  );

-- Update: a guardian may update their juniors too (column grants still limit
-- which columns can change — display_name / belt_rank / gym_id from prior files).
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or managed_by = auth.uid())
  with check (id = auth.uid() or managed_by = auth.uid());

-- Delete: a guardian may delete a junior they manage (self-deletion of a real
-- account goes through the delete-account edge function, not this policy).
grant delete on public.profiles to authenticated;
drop policy if exists "profiles_delete_managed_junior" on public.profiles;
create policy "profiles_delete_managed_junior" on public.profiles
  for delete to authenticated using (managed_by = auth.uid());
