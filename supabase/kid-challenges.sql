-- ============================================================================
-- Roll for Rating — Kid-vs-kid challenges off the leaderboard  [Phase B]
-- Run after managed-juniors-phase2.sql + geo-leaderboard.sql. Safe to re-run.
--
-- INVITE model: a guardian challenges another kid on the 13-&-under board on
-- behalf of their own junior. The challenged kid's guardian accepts/declines.
-- On accept they arrange in person and create the real refereed match via the
-- normal flow. No child is ever contacted directly; the board stays anonymous
-- (a challenge targets an opaque id — names are never exposed by it).
-- ============================================================================

create table if not exists public.match_requests (
  id          uuid primary key default gen_random_uuid(),
  from_junior uuid not null references public.profiles (id) on delete cascade,
  to_junior   uuid not null references public.profiles (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at  timestamptz not null default now(),
  constraint mr_distinct check (from_junior <> to_junior)
);
create index if not exists match_requests_to_idx   on public.match_requests (to_junior);
create index if not exists match_requests_from_idx on public.match_requests (from_junior);
alter table public.match_requests enable row level security;

-- Only the guardians of the two juniors can see a request. All writes go
-- through the SECURITY DEFINER functions below (no insert/update policy).
drop policy if exists "mr_read" on public.match_requests;
create policy "mr_read" on public.match_requests for select to authenticated using (
  public.is_my_junior(from_junior) or public.is_my_junior(to_junior)
);

-- Issue a challenge on behalf of one of my juniors against another kid.
create or replace function public.create_match_request(p_from_junior uuid, p_to_junior uuid)
returns public.match_requests
language plpgsql security definer set search_path = public as $$
declare r public.match_requests; t record;
begin
  if not public.is_my_junior(p_from_junior) then
    raise exception 'You can only challenge on behalf of a junior you manage';
  end if;
  if p_from_junior = p_to_junior then raise exception 'Pick a different opponent'; end if;
  select is_minor into t from public.profiles where id = p_to_junior;
  if t is null then raise exception 'Opponent not found'; end if;
  if not coalesce(t.is_minor, false) then
    raise exception 'Juniors can only challenge other under-18 members';
  end if;
  if exists (
    select 1 from public.match_requests
    where from_junior = p_from_junior and to_junior = p_to_junior and status = 'pending'
  ) then
    raise exception 'You already have a pending challenge to this athlete';
  end if;

  insert into public.match_requests (from_junior, to_junior, created_by)
  values (p_from_junior, p_to_junior, auth.uid())
  returning * into r;
  return r;
end; $$;

-- The challenged junior's guardian accepts or declines.
create or replace function public.respond_match_request(p_id uuid, p_accept boolean)
returns public.match_requests
language plpgsql security definer set search_path = public as $$
declare r public.match_requests;
begin
  select * into r from public.match_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_my_junior(r.to_junior) then
    raise exception 'Only the challenged athlete''s guardian can respond';
  end if;
  if r.status <> 'pending' then raise exception 'This challenge is no longer pending'; end if;
  update public.match_requests
     set status = case when p_accept then 'accepted' else 'declined' end
   where id = p_id returning * into r;
  return r;
end; $$;

-- The challenger's guardian can cancel their own pending challenge.
create or replace function public.cancel_match_request(p_id uuid)
returns public.match_requests
language plpgsql security definer set search_path = public as $$
declare r public.match_requests;
begin
  select * into r from public.match_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_my_junior(r.from_junior) then
    raise exception 'Only the challenger''s guardian can cancel';
  end if;
  if r.status <> 'pending' then raise exception 'This challenge is no longer pending'; end if;
  update public.match_requests set status = 'cancelled' where id = p_id returning * into r;
  return r;
end; $$;

-- List a guardian's challenges (both directions) with FIRST NAMES ONLY — keeps
-- the board's anonymity while letting them decide. other_id is opaque (used to
-- deep-link the eventual match); profiles stay unreadable via RLS.
create or replace function public.my_match_requests()
returns table (
  id uuid, direction text, status text, created_at timestamptz,
  my_junior_id uuid, my_junior_first text,
  other_id uuid, other_first text, other_rating integer
)
language sql stable security definer set search_path = public as $$
  select
    mr.id,
    case when public.is_my_junior(mr.to_junior) then 'incoming' else 'outgoing' end as direction,
    mr.status, mr.created_at,
    (case when public.is_my_junior(mr.to_junior) then mr.to_junior else mr.from_junior end) as my_junior_id,
    split_part((select display_name from public.profiles where id =
      case when public.is_my_junior(mr.to_junior) then mr.to_junior else mr.from_junior end), ' ', 1) as my_junior_first,
    (case when public.is_my_junior(mr.to_junior) then mr.from_junior else mr.to_junior end) as other_id,
    split_part((select display_name from public.profiles where id =
      case when public.is_my_junior(mr.to_junior) then mr.from_junior else mr.to_junior end), ' ', 1) as other_first,
    (select rating from public.profiles where id =
      case when public.is_my_junior(mr.to_junior) then mr.from_junior else mr.to_junior end) as other_rating
  from public.match_requests mr
  where public.is_my_junior(mr.from_junior) or public.is_my_junior(mr.to_junior)
  order by mr.created_at desc;
$$;

revoke all on function public.my_match_requests() from public, anon;
grant execute on function public.my_match_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Once a challenge (or an actual match) links two juniors, each guardian can
-- read the OTHER kid's profile — needed to arrange and render the match.
-- (Extends the profiles read policy from managed-juniors.sql.)
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or age_tier = 'adult'
    or (age_tier = 'teen' and consent_status = 'verified')
    or (gym_id is not null and gym_id = public.my_gym_id())
    or managed_by = auth.uid()
    or exists (
      select 1 from public.match_requests mr
      where (mr.from_junior = public.profiles.id and public.is_my_junior(mr.to_junior))
         or (mr.to_junior   = public.profiles.id and public.is_my_junior(mr.from_junior))
    )
    or exists (
      select 1 from public.matches m
      where (m.challenger_id = public.profiles.id or m.opponent_id = public.profiles.id)
        and (public.is_my_junior(m.challenger_id) or public.is_my_junior(m.opponent_id))
    )
  );
