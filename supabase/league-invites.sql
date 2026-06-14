-- ============================================================================
-- Roll for Rating — League invites
-- Run in the Supabase SQL editor (after leagues.sql). Safe to re-run.
--
-- Leagues were join-by-code only, so an organizer had no way to pull specific
-- people in. This mirrors tournament-invites: the organizer invites a user, who
-- gets a notification + a pending invite they accept (joins as a member) or
-- decline.
-- ============================================================================

create table if not exists public.league_invites (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references public.leagues(id) on delete cascade,
  invited_user uuid not null references public.profiles(id) on delete cascade,
  invited_by   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at   timestamptz not null default now(),
  unique (league_id, invited_user)
);

alter table public.league_invites enable row level security;

-- Is the caller the organizer of this league?
create or replace function public.is_league_organizer(p_lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leagues l where l.id = p_lid and l.created_by = auth.uid()
  ) or exists (
    select 1 from public.league_members m
    where m.league_id = p_lid and m.user_id = auth.uid() and m.role = 'organizer'
  );
$$;
grant execute on function public.is_league_organizer(uuid) to authenticated;

drop policy if exists "linv_read" on public.league_invites;
create policy "linv_read" on public.league_invites for select to authenticated
  using (invited_user = auth.uid() or public.is_league_organizer(league_id));

create index if not exists idx_linv_user on public.league_invites (invited_user, status);

-- Organizer invites a user to their league (+ notifies them).
create or replace function public.invite_to_league(p_lid uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hname text; lname text;
begin
  if not public.is_league_organizer(p_lid) then raise exception 'Only the organizer can invite players.'; end if;
  if exists (select 1 from public.league_members where league_id = p_lid and user_id = p_user and active) then
    raise exception 'They are already a member.';
  end if;

  insert into public.league_invites (league_id, invited_user, invited_by, status)
  values (p_lid, p_user, auth.uid(), 'pending')
  on conflict (league_id, invited_user)
    do update set status = 'pending', invited_by = auth.uid(), created_at = now();

  select display_name into hname from public.profiles where id = auth.uid();
  select name into lname from public.leagues where id = p_lid;
  insert into public.notifications (user_id, type, title, body, data, match_id) values
    (p_user, 'league_invite', 'League invite', hname || ' invited you to ' || lname,
      jsonb_build_object('k', 'league.invite', 'name', hname, 'lid', p_lid), null);
end; $$;
grant execute on function public.invite_to_league(uuid, uuid) to authenticated;

-- The invited user accepts (joins as a member) or declines.
create or replace function public.respond_league_invite(p_lid uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.league_invites
    set status = case when p_accept then 'accepted' else 'declined' end
    where league_id = p_lid and invited_user = auth.uid() and status = 'pending';
  if not found then raise exception 'No pending invite for this league.'; end if;
  if p_accept then
    insert into public.league_members (league_id, user_id, role, active)
    values (p_lid, auth.uid(), 'member', true)
    on conflict (league_id, user_id) do update set active = true;
  end if;
end; $$;
grant execute on function public.respond_league_invite(uuid, boolean) to authenticated;

-- Pending league invites for the caller.
create or replace function public.my_league_invites()
returns table (league_id uuid, name text, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select li.league_id, l.name, p.display_name, li.created_at
  from public.league_invites li
  join public.leagues l on l.id = li.league_id
  join public.profiles p on p.id = li.invited_by
  where li.invited_user = auth.uid() and li.status = 'pending'
  order by li.created_at desc;
$$;
grant execute on function public.my_league_invites() to authenticated;

-- Whether the caller has a pending invite to a given league.
create or replace function public.has_league_invite(p_lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.league_invites
    where league_id = p_lid and invited_user = auth.uid() and status = 'pending'
  );
$$;
grant execute on function public.has_league_invite(uuid) to authenticated;

select 'league-invites-installed' as ok;
