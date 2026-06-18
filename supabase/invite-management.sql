-- ============================================================================
-- Roll for Rating — Invite management (bulk invite + sent-invite lists)
-- Run AFTER league-invites.sql and tournament-invites.sql. Safe to re-run.
--
-- Powers the dedicated "Invite players" screen: the organizer/host stages a
-- batch of people and sends them all at once (invite_many_*), and sees who has
-- been invited and who declined (*_invites_sent). Mirrors the single-invite
-- logic already in those files (same notification, same conflict handling).
-- ============================================================================

-- ---- Leagues ---------------------------------------------------------------

-- Invite several people to a league in one call. Returns how many invites were
-- actually sent (already-active members are skipped). Organizer only.
create or replace function public.invite_many_to_league(p_lid uuid, p_users uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare hname text; lname text; u uuid; n int := 0;
begin
  if not public.is_league_organizer(p_lid) then raise exception 'Only the organizer can invite players.'; end if;
  select display_name into hname from public.profiles where id = auth.uid();
  select name into lname from public.leagues where id = p_lid;
  foreach u in array coalesce(p_users, '{}'::uuid[]) loop
    if u = auth.uid() then continue; end if;
    if exists (select 1 from public.league_members where league_id = p_lid and user_id = u and active) then continue; end if;
    insert into public.league_invites (league_id, invited_user, invited_by, status)
    values (p_lid, u, auth.uid(), 'pending')
    on conflict (league_id, invited_user)
      do update set status = 'pending', invited_by = auth.uid(), created_at = now();
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (u, 'league_invite', 'League invite', hname || ' invited you to ' || lname,
        jsonb_build_object('k', 'league.invite', 'name', hname, 'lid', p_lid), null);
    n := n + 1;
  end loop;
  return n;
end; $$;
grant execute on function public.invite_many_to_league(uuid, uuid[]) to authenticated;

-- Everyone the organizer has invited to a league, with status. Organizer only.
create or replace function public.league_invites_sent(p_lid uuid)
returns table (user_id uuid, display_name text, username text, belt_rank text, rating integer, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select li.invited_user, p.display_name, p.username, p.belt_rank::text, p.rating, li.status, li.created_at
  from public.league_invites li
  join public.profiles p on p.id = li.invited_user
  where li.league_id = p_lid and public.is_league_organizer(p_lid)
  order by li.created_at desc;
$$;
grant execute on function public.league_invites_sent(uuid) to authenticated;

-- ---- Tournaments -----------------------------------------------------------

-- Invite several people to a tournament in one call. Returns how many were sent
-- (already-registered entrants are skipped). Host only.
create or replace function public.invite_many_to_tournament(p_tid uuid, p_users uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare hname text; tname text; u uuid; n int := 0;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can invite players.'; end if;
  select display_name into hname from public.profiles where id = auth.uid();
  select name into tname from public.tournaments where id = p_tid;
  foreach u in array coalesce(p_users, '{}'::uuid[]) loop
    if u = auth.uid() then continue; end if;
    if exists (select 1 from public.tournament_entrants where tournament_id = p_tid and user_id = u) then continue; end if;
    insert into public.tournament_invites (tournament_id, invited_user, invited_by, status)
    values (p_tid, u, auth.uid(), 'pending')
    on conflict (tournament_id, invited_user)
      do update set status = 'pending', invited_by = auth.uid(), created_at = now();
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (u, 'tournament_invite', 'Tournament invite', hname || ' invited you to ' || tname,
        jsonb_build_object('k', 'tournament.invite', 'name', hname, 'tid', p_tid), null);
    n := n + 1;
  end loop;
  return n;
end; $$;
grant execute on function public.invite_many_to_tournament(uuid, uuid[]) to authenticated;

-- Everyone the host has invited to a tournament, with status. Host only.
create or replace function public.tournament_invites_sent(p_tid uuid)
returns table (user_id uuid, display_name text, username text, belt_rank text, rating integer, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ti.invited_user, p.display_name, p.username, p.belt_rank::text, p.rating, ti.status, ti.created_at
  from public.tournament_invites ti
  join public.profiles p on p.id = ti.invited_user
  where ti.tournament_id = p_tid and public.is_tournament_host(p_tid)
  order by ti.created_at desc;
$$;
grant execute on function public.tournament_invites_sent(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'invite-management installed' as ok;
