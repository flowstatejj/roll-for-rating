-- ============================================================================
-- Rollr — Community layer (gyms, gym friendships, open mats)
-- Run this in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gyms
-- ---------------------------------------------------------------------------
create table if not exists public.gyms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  description text,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists gyms_city_idx on public.gyms (lower(city));

-- A member belongs to (at most) one gym.
alter table public.profiles add column if not exists gym_id uuid references public.gyms (id) on delete set null;

-- ---------------------------------------------------------------------------
-- gym_friendships — mutual link between two gyms (canonical ordered pair)
-- ---------------------------------------------------------------------------
create table if not exists public.gym_friendships (
  id               uuid primary key default gen_random_uuid(),
  gym_low          uuid not null references public.gyms (id) on delete cascade,
  gym_high         uuid not null references public.gyms (id) on delete cascade,
  requested_by_gym uuid not null references public.gyms (id) on delete cascade,
  status           text not null default 'pending',  -- pending | accepted
  created_at       timestamptz not null default now(),
  unique (gym_low, gym_high),
  constraint gym_pair_ordered check (gym_low < gym_high)
);

-- ---------------------------------------------------------------------------
-- open_mats — community-sourced listings
-- ---------------------------------------------------------------------------
create table if not exists public.open_mats (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  gym_id     uuid references public.gyms (id) on delete set null,
  city       text,
  address    text,
  schedule   text,           -- e.g. "Saturdays 11:00 AM"
  notes      text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists open_mats_city_idx on public.open_mats (lower(city));

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.gyms enable row level security;
alter table public.gym_friendships enable row level security;
alter table public.open_mats enable row level security;

-- gyms: readable by all signed-in; create/update via owner.
drop policy if exists "gyms_read" on public.gyms;
create policy "gyms_read" on public.gyms for select to authenticated using (true);
drop policy if exists "gyms_insert" on public.gyms;
create policy "gyms_insert" on public.gyms for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "gyms_update_owner" on public.gyms;
create policy "gyms_update_owner" on public.gyms for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Allow members to set their own gym_id directly (join/leave).
revoke update on public.profiles from authenticated;
grant update (display_name, belt_rank, gym_id) on public.profiles to authenticated;

-- gym friendships: readable by all signed-in; mutations via the functions below.
drop policy if exists "gym_friendships_read" on public.gym_friendships;
create policy "gym_friendships_read" on public.gym_friendships for select to authenticated using (true);

-- open mats: readable by all; create as yourself; delete your own.
drop policy if exists "open_mats_read" on public.open_mats;
create policy "open_mats_read" on public.open_mats for select to authenticated using (true);
drop policy if exists "open_mats_insert" on public.open_mats;
create policy "open_mats_insert" on public.open_mats for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "open_mats_delete" on public.open_mats;
create policy "open_mats_delete" on public.open_mats for delete to authenticated using (created_by = auth.uid());

-- ============================================================================
-- Functions
-- ============================================================================

-- Create a gym, become its owner, and join it.
create or replace function public.create_gym(p_name text, p_city text, p_description text)
returns public.gyms
language plpgsql security definer set search_path = public
as $$
declare g public.gyms;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Gym name is required'; end if;
  insert into public.gyms (name, city, description, owner_id)
  values (trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_description), ''), auth.uid())
  returning * into g;
  update public.profiles set gym_id = g.id where id = auth.uid();
  return g;
end; $$;

-- The gym (if any) owned by the current user.
create or replace function public.my_owned_gym()
returns uuid language sql stable security definer set search_path = public
as $$ select id from public.gyms where owner_id = auth.uid() limit 1 $$;

-- A gym owner requests friendship with another gym.
create or replace function public.request_gym_friendship(p_target_gym uuid)
returns public.gym_friendships
language plpgsql security definer set search_path = public
as $$
declare my_gym uuid; lo uuid; hi uuid; f public.gym_friendships;
begin
  my_gym := public.my_owned_gym();
  if my_gym is null then raise exception 'You must own a gym to send gym requests'; end if;
  if my_gym = p_target_gym then raise exception 'A gym cannot friend itself'; end if;
  lo := least(my_gym, p_target_gym);
  hi := greatest(my_gym, p_target_gym);
  insert into public.gym_friendships (gym_low, gym_high, requested_by_gym, status)
  values (lo, hi, my_gym, 'pending')
  on conflict (gym_low, gym_high) do nothing;
  select * into f from public.gym_friendships where gym_low = lo and gym_high = hi;
  return f;
end; $$;

-- The other gym's owner accepts (or declines) a request.
create or replace function public.respond_gym_friendship(p_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare my_gym uuid; f public.gym_friendships;
begin
  select * into f from public.gym_friendships where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  my_gym := public.my_owned_gym();
  if my_gym is null or my_gym not in (f.gym_low, f.gym_high) or my_gym = f.requested_by_gym then
    raise exception 'Only the other gym''s owner can respond';
  end if;
  if p_accept then
    update public.gym_friendships set status = 'accepted' where id = p_id;
  else
    delete from public.gym_friendships where id = p_id;
  end if;
end; $$;
