-- ============================================================================
-- Roll for Rating — Tournament invites
-- Run in the Supabase SQL editor (after tournaments-pro.sql). Safe to re-run.
--
-- tournament_entrants is self-insert only (you can register yourself), so a host
-- had no way to bring specific people in. This adds host-driven invites: the
-- host invites a user, they get a notification + a pending invite they accept
-- (which registers them as an entrant) or decline.
-- ============================================================================

create table if not exists public.tournament_invites (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  invited_user  uuid not null references public.profiles(id) on delete cascade,
  invited_by    uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  unique (tournament_id, invited_user)
);

alter table public.tournament_invites enable row level security;

-- The invited user and the host can read invites; all writes go through the
-- SECURITY DEFINER functions below (no direct insert/update/delete policy).
drop policy if exists "tinv_read" on public.tournament_invites;
create policy "tinv_read" on public.tournament_invites for select to authenticated
  using (invited_user = auth.uid() or public.is_tournament_host(tournament_id));

create index if not exists idx_tinv_user on public.tournament_invites (invited_user, status);

-- Host invites a user to their tournament (+ notifies them).
create or replace function public.invite_to_tournament(p_tid uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hname text; tname text;
begin
  if not public.is_tournament_host(p_tid) then raise exception 'Only the host can invite players.'; end if;
  if p_user = auth.uid() then raise exception 'You are the host of this tournament.'; end if;
  if exists (select 1 from public.tournament_entrants where tournament_id = p_tid and user_id = p_user) then
    raise exception 'They are already registered.';
  end if;

  insert into public.tournament_invites (tournament_id, invited_user, invited_by, status)
  values (p_tid, p_user, auth.uid(), 'pending')
  on conflict (tournament_id, invited_user)
    do update set status = 'pending', invited_by = auth.uid(), created_at = now();

  select display_name into hname from public.profiles where id = auth.uid();
  select name into tname from public.tournaments where id = p_tid;
  insert into public.notifications (user_id, type, title, body, data, match_id) values
    (p_user, 'tournament_invite', 'Tournament invite', hname || ' invited you to ' || tname,
      jsonb_build_object('k', 'tournament.invite', 'name', hname, 'tid', p_tid), null);
end; $$;
grant execute on function public.invite_to_tournament(uuid, uuid) to authenticated;

-- The invited user accepts (registers as an entrant) or declines.
create or replace function public.respond_tournament_invite(p_tid uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tournament_invites
    set status = case when p_accept then 'accepted' else 'declined' end
    where tournament_id = p_tid and invited_user = auth.uid() and status = 'pending';
  if not found then raise exception 'No pending invite for this tournament.'; end if;
  if p_accept then
    insert into public.tournament_entrants (tournament_id, user_id)
    values (p_tid, auth.uid()) on conflict do nothing;
  end if;
end; $$;
grant execute on function public.respond_tournament_invite(uuid, boolean) to authenticated;

-- Pending invites for the caller (for the "Invited to" list + the tournament screen).
create or replace function public.my_tournament_invites()
returns table (tournament_id uuid, name text, format text, invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ti.tournament_id, t.name, t.format::text, p.display_name, ti.created_at
  from public.tournament_invites ti
  join public.tournaments t on t.id = ti.tournament_id
  join public.profiles p on p.id = ti.invited_by
  where ti.invited_user = auth.uid() and ti.status = 'pending'
  order by ti.created_at desc;
$$;
grant execute on function public.my_tournament_invites() to authenticated;

-- Whether the caller has a pending invite to a given tournament (for the detail screen).
create or replace function public.has_tournament_invite(p_tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_invites
    where tournament_id = p_tid and invited_user = auth.uid() and status = 'pending'
  );
$$;
grant execute on function public.has_tournament_invite(uuid) to authenticated;
