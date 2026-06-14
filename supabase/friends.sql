-- ============================================================================
-- Roll for Rating — Friends
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- A friend graph so people can connect and then quickly invite each other to
-- leagues & tournaments. One row per relationship (requester -> addressee).
-- A unique index on the unordered pair prevents A->B and B->A duplicates.
-- All writes go through SECURITY DEFINER RPCs; reads are gated by RLS.
-- ============================================================================

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester    uuid not null references public.profiles(id) on delete cascade,
  addressee    uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester <> addressee)
);

-- One relationship per pair, regardless of who sent the request.
create unique index if not exists idx_friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists idx_friendships_addressee on public.friendships (addressee, status);
create index if not exists idx_friendships_requester on public.friendships (requester, status);

alter table public.friendships enable row level security;

-- You can read any friendship you're part of; all writes go through the fns.
drop policy if exists "friendships_read" on public.friendships;
create policy "friendships_read" on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- ---------------------------------------------------------------------------
-- Send a friend request (auto-accepts if the other person already asked you).
-- ---------------------------------------------------------------------------
create or replace function public.send_friend_request(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); myname text; existing record;
begin
  if p_user = me then raise exception 'You cannot friend yourself.'; end if;

  -- Don't friend protected juniors, or anyone in a block relationship with you.
  if exists (select 1 from public.profiles where id = p_user and age_tier = 'kid') then
    raise exception 'This account is not available.';
  end if;
  if exists (
    select 1 from public.blocked_users
    where (blocker_id = me and blocked_id = p_user) or (blocker_id = p_user and blocked_id = me)
  ) then raise exception 'This account is not available.'; end if;

  select * into existing from public.friendships
    where least(requester, addressee) = least(me, p_user)
      and greatest(requester, addressee) = greatest(me, p_user);

  if found then
    if existing.status = 'accepted' then raise exception 'You are already friends.'; end if;
    -- A pending request exists. If THEY asked YOU, accept it; otherwise it's a dup.
    if existing.addressee = me then
      return public.respond_friend_request(existing.requester, true);
    end if;
    raise exception 'Request already pending.';
  end if;

  insert into public.friendships (requester, addressee, status) values (me, p_user, 'pending');

  select display_name into myname from public.profiles where id = me;
  insert into public.notifications (user_id, type, title, body, data, match_id) values
    (p_user, 'friend_request', 'Friend request', myname || ' sent you a friend request',
      jsonb_build_object('k', 'friend.request', 'name', myname, 'fid', me), null);
  return 'requested';
end; $$;
grant execute on function public.send_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Respond to a pending request you received: accept (become friends) or decline.
-- ---------------------------------------------------------------------------
create or replace function public.respond_friend_request(p_requester uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); myname text;
begin
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
      where requester = p_requester and addressee = me and status = 'pending';
    if not found then raise exception 'No pending request from this person.'; end if;
    select display_name into myname from public.profiles where id = me;
    insert into public.notifications (user_id, type, title, body, data, match_id) values
      (p_requester, 'friend_accepted', 'Friend request accepted', myname || ' accepted your friend request',
        jsonb_build_object('k', 'friend.accepted', 'name', myname, 'fid', me), null);
    return 'accepted';
  else
    delete from public.friendships
      where requester = p_requester and addressee = me and status = 'pending';
    return 'declined';
  end if;
end; $$;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Remove a friend (either direction) or cancel a request you sent.
create or replace function public.remove_friend(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  delete from public.friendships
    where least(requester, addressee) = least(me, p_user)
      and greatest(requester, addressee) = greatest(me, p_user)
      and (requester = me or addressee = me);
end; $$;
grant execute on function public.remove_friend(uuid) to authenticated;

-- Accepted friends of the caller (profile fields for display + the invite picker).
create or replace function public.my_friends()
returns table (id uuid, username text, display_name text, belt_rank text,
               rating int, avatar_warrior text, avatar_color text, avatar_path text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.belt_rank::text, p.rating,
         p.avatar_warrior, p.avatar_color, p.avatar_path, f.responded_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
  order by p.display_name asc;
$$;
grant execute on function public.my_friends() to authenticated;

-- Incoming pending requests (people who asked to friend the caller).
create or replace function public.my_friend_requests()
returns table (id uuid, username text, display_name text, belt_rank text,
               rating int, avatar_warrior text, avatar_color text, avatar_path text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.belt_rank::text, p.rating,
         p.avatar_warrior, p.avatar_color, p.avatar_path, f.created_at
  from public.friendships f
  join public.profiles p on p.id = f.requester
  where f.addressee = auth.uid() and f.status = 'pending'
  order by f.created_at desc;
$$;
grant execute on function public.my_friend_requests() to authenticated;

-- Relationship of the caller to one user: none | pending_out | pending_in | friends.
create or replace function public.friendship_status(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when f.status = 'accepted' then 'friends'
      when f.requester = auth.uid() then 'pending_out'
      else 'pending_in'
    end
    from public.friendships f
    where least(f.requester, f.addressee) = least(auth.uid(), p_user)
      and greatest(f.requester, f.addressee) = greatest(auth.uid(), p_user)
    limit 1
  ), 'none');
$$;
grant execute on function public.friendship_status(uuid) to authenticated;

select 'friends-installed' as ok;
