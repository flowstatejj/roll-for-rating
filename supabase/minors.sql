-- ============================================================================
-- Roll for Rating — Age tiers + parental consent (minor protections)
-- Run in the Supabase SQL Editor (after schema.sql, social.sql, public-matches,
-- challenges). Safe to re-run. Everything is enforced server-side (RLS +
-- triggers) so the app can never bypass it.
--
-- Tiers (computed from birthdate):
--   adult  (18+)   full access
--   teen   (14-17) with verified parent consent: public matches, leaderboard,
--                  match anyone. Never wagering. Restricted until verified.
--   kid    (<14)   locked down: no public, no leaderboard, not searchable,
--                  no wagering, matches only within their own gym.
-- ============================================================================

-- --- Columns --------------------------------------------------------------
alter table public.profiles add column if not exists is_minor       boolean not null default false;
alter table public.profiles add column if not exists birthdate      date;
alter table public.profiles add column if not exists age_tier       text not null default 'adult';
alter table public.profiles add column if not exists consent_status text not null default 'not_required';

do $$ begin
  alter table public.profiles add constraint profiles_age_tier_chk
    check (age_tier in ('adult','teen','kid'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_consent_chk
    check (consent_status in ('not_required','pending','verified'));
exception when duplicate_object then null; end $$;

-- --- Tier helper (stable: reflects the current date) ----------------------
create or replace function public.tier_for(bd date)
returns text language sql stable as $$
  select case
    when bd is null then 'adult'
    when bd > current_date - interval '14 years' then 'kid'
    when bd > current_date - interval '18 years' then 'teen'
    else 'adult'
  end;
$$;

-- --- Parental consent tokens (locked table: clients can't read it) --------
-- No RLS policies are created, so the anon/authenticated roles cannot select,
-- insert, or update here. Only the service_role (used by the Edge Functions)
-- bypasses RLS. This stops a minor from approving their own account.
create table if not exists public.parent_consents (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  parent_email text not null,
  token        uuid not null default gen_random_uuid(),
  status       text not null default 'pending' check (status in ('pending','verified')),
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);
alter table public.parent_consents enable row level security;

-- --- Seed profile + consent from sign-up metadata -------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare bd date;
begin
  bd := nullif(new.raw_user_meta_data ->> 'birthdate', '')::date;

  insert into public.profiles (id, username, display_name, belt_rank, birthdate)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username', 'New Grappler'),
    coalesce((new.raw_user_meta_data ->> 'belt_rank')::belt_rank, 'white'),
    bd
  );
  -- (the profiles trigger below fills in age_tier / is_minor / consent_status)

  if public.tier_for(bd) <> 'adult'
     and nullif(new.raw_user_meta_data ->> 'parent_email', '') is not null then
    insert into public.parent_consents (user_id, parent_email)
    values (new.id, new.raw_user_meta_data ->> 'parent_email')
    on conflict (user_id) do nothing;
  end if;

  return new;
end; $$;

-- --- The caller's own gym (SECURITY DEFINER so the RLS policy can't recurse)
create or replace function public.my_gym_id()
returns uuid language sql stable security definer set search_path = public
as $$ select gym_id from public.profiles where id = auth.uid() $$;

-- --- Keep age_tier / is_minor / consent_status / privileges correct --------
create or replace function public.enforce_minor_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.age_tier := public.tier_for(new.birthdate);
  new.is_minor := new.age_tier <> 'adult';

  if tg_op = 'INSERT' then
    if new.is_minor then
      if coalesce(new.consent_status, 'not_required') = 'not_required' then
        new.consent_status := 'pending';
      end if;
    else
      new.consent_status := 'not_required';
    end if;
  else
    -- on update: never downgrade a 'verified' consent; clear it once adult
    if not new.is_minor then
      new.consent_status := 'not_required';
    elsif new.consent_status is null then
      new.consent_status := 'pending';
    end if;
  end if;

  -- Kids and not-yet-verified minors can never be listed as open for a challenge.
  if new.age_tier = 'kid' or (new.is_minor and new.consent_status <> 'verified') then
    new.open_for_challenge := false;
  end if;

  return new;
end; $$;
drop trigger if exists trg_minor_profile on public.profiles;
create trigger trg_minor_profile before insert or update on public.profiles
  for each row execute function public.enforce_minor_profile();

-- --- Profile visibility ----------------------------------------------------
-- Adults and verified teens are public. Kids and not-yet-verified minors are
-- visible only to themselves and same-gym members (never publicly searchable).
drop policy if exists "profiles_read_all" on public.profiles;
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or age_tier = 'adult'
    or (age_tier = 'teen' and consent_status = 'verified')
    or (gym_id is not null and gym_id = public.my_gym_id())
  );

-- --- Match enforcement -----------------------------------------------------
create or replace function public.enforce_minor_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record; o record;
begin
  select is_minor, age_tier, consent_status into c
    from public.profiles where id = new.challenger_id;
  select is_minor, age_tier, consent_status into o
    from public.profiles where id = new.opponent_id;

  -- A minor can't compete until a parent has verified consent.
  if c.is_minor and c.consent_status <> 'verified' then
    raise exception 'This account is pending parental consent and cannot start matches yet.';
  end if;
  if o.is_minor and o.consent_status <> 'verified' then
    raise exception 'That opponent''s account is pending parental consent and cannot be matched yet.';
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
