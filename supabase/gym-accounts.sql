-- ============================================================================
-- Roll for Rating - Gym accounts (free, verified)
-- Run AFTER family-plan.sql + elite-memberships.sql. Safe to re-run.
--
-- A gym applies from the paywall (name, address, web/social link, owner).
-- The owner approves in the in-app admin queue. Approval makes the account a
-- verified gym: free access (comp entitlement), participating=false (never
-- ranks, never challengeable - same plumbing as guardians), linked to its
-- gym (created if new), 4 Elite memberships to grant, and full organizer
-- powers (tournaments, leagues, open mats, leaderboards).
-- ============================================================================

-- ---- Profile flags ----------------------------------------------------------

alter table public.profiles
  add column if not exists is_gym_account boolean not null default false;
alter table public.profiles
  add column if not exists gym_verified boolean not null default false;

-- ---- Applications -----------------------------------------------------------

create table if not exists public.gym_applications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references public.profiles(id) on delete cascade,
  gym_name    text not null,
  address     text not null,
  link        text not null,   -- website / Instagram / Google Maps
  owner_name  text not null,
  status      text not null default 'pending' check (status in ('pending','approved','denied')),
  note        text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles(id)
);

alter table public.gym_applications enable row level security;
drop policy if exists "gym_apps_read" on public.gym_applications;
create policy "gym_apps_read" on public.gym_applications for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- The signed-in user applies (or re-applies after a denial). Works while
-- paywalled: it only needs auth, not an entitlement.
create or replace function public.apply_gym_account(
  p_gym_name text, p_address text, p_link text, p_owner_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cur text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if btrim(p_gym_name) = '' or btrim(p_address) = '' or btrim(p_link) = '' or btrim(p_owner_name) = '' then
    raise exception 'All fields are required.';
  end if;
  if exists (select 1 from public.profiles where id = me and is_minor) then
    raise exception 'Gym accounts must be created by an adult.';
  end if;
  select status into cur from public.gym_applications where profile_id = me;
  if cur = 'approved' then
    return jsonb_build_object('status', 'approved');
  end if;
  insert into public.gym_applications (profile_id, gym_name, address, link, owner_name)
  values (me, btrim(p_gym_name), btrim(p_address), btrim(p_link), btrim(p_owner_name))
  on conflict (profile_id) do update set
    gym_name = excluded.gym_name, address = excluded.address, link = excluded.link,
    owner_name = excluded.owner_name, status = 'pending', note = null,
    created_at = now(), decided_at = null, decided_by = null;
  return jsonb_build_object('status', 'pending');
end; $$;
grant execute on function public.apply_gym_account(text, text, text, text) to authenticated;

-- The caller's application status (null when none).
create or replace function public.my_gym_application()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('status', status, 'gym_name', gym_name, 'note', note, 'created_at', created_at)
    from public.gym_applications where profile_id = auth.uid()
  ), 'null'::jsonb);
$$;
grant execute on function public.my_gym_application() to authenticated;

-- Admin queue: pending applications with a vouch signal - how many active
-- (participating) members already list a same-named gym in the app.
create or replace function public.admin_gym_applications()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'profile_id', a.profile_id,
      'gym_name', a.gym_name, 'address', a.address, 'link', a.link,
      'owner_name', a.owner_name, 'created_at', a.created_at,
      'account_name', p.display_name, 'account_username', p.username,
      'vouch', (
        select count(*) from public.profiles m
        join public.gyms g on g.id = m.gym_id
        where lower(g.name) = lower(a.gym_name) and m.participating
      )
    ) order by a.created_at)
    from public.gym_applications a
    join public.profiles p on p.id = a.profile_id
    where a.status = 'pending'
  ), '[]'::jsonb) end;
$$;
grant execute on function public.admin_gym_applications() to authenticated;

-- Approve or deny. Approval: flag the profile, stop it competing (guardian
-- plumbing), link or create the gym, comp the account, notify. Denial: notify
-- with the optional note; the gym can fix details and re-apply.
create or replace function public.admin_decide_gym(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare app record; v_gym uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into app from public.gym_applications where id = p_id and status = 'pending';
  if app is null then raise exception 'Application not found or already decided'; end if;

  update public.gym_applications
     set status = case when p_approve then 'approved' else 'denied' end,
         note = p_note, decided_at = now(), decided_by = auth.uid()
   where id = p_id;

  if p_approve then
    -- Link an existing same-named gym, else create one owned by the account.
    select id into v_gym from public.gyms where lower(name) = lower(app.gym_name) limit 1;
    if v_gym is null then
      insert into public.gyms (name, city, description, owner_id)
      values (app.gym_name, app.address, null, app.profile_id)
      returning id into v_gym;
    end if;
    update public.profiles
       set is_gym_account = true, gym_verified = true, participating = false, gym_id = v_gym
     where id = app.profile_id;
    -- The account may have competed before converting: kill its open matches so
    -- nothing settles rating onto a gym account (the insert trigger only guards
    -- NEW matches; acceptance/recording are UPDATEs on existing rows).
    update public.matches
       set status = 'cancelled'
     where (challenger_id = app.profile_id or opponent_id = app.profile_id)
       and status in ('pending_opponent','pending_referee','pending_confirmation');
    -- Comp the account. If a store trial/sub is currently active this no-ops by
    -- design (grant_comp_entitlement never clobbers a paid row); access is still
    -- guaranteed because has_active_entitlement (below) treats verified gyms as
    -- entitled by flag.
    perform public.grant_comp_entitlement(app.profile_id, 'comp:gym');
    insert into public.notifications (user_id, type, title, body, data)
    values (app.profile_id, 'gym_account', 'Gym account approved',
            'Your gym account is live: 4 Elite memberships, tournaments, and leagues are unlocked.',
            jsonb_build_object('k', 'gym.approved'));
  else
    insert into public.notifications (user_id, type, title, body, data)
    values (app.profile_id, 'gym_account', 'Gym application update',
            coalesce(nullif(btrim(p_note), ''), 'Your gym application was not approved. You can update the details and re-apply.'),
            jsonb_build_object('k', 'gym.denied'));
  end if;
end; $$;
grant execute on function public.admin_decide_gym(uuid, boolean, text) to authenticated;

-- ---- Elite quota: founders 10, verified gyms 4 ------------------------------

create or replace function public.elite_quota_for(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles where id = p_user and is_founding_member) then 10
    when exists (select 1 from public.profiles where id = p_user and is_gym_account and gym_verified) then 4
    else 0
  end;
$$;

create or replace function public.grant_elite(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid; used int; quota int; tname text;
begin
  quota := public.elite_quota_for(me);
  if quota = 0 then
    raise exception 'Only founding members and verified gyms can grant elite memberships.';
  end if;
  select id into target from auth.users where lower(email) = lower(btrim(p_email));
  if target is null then
    return jsonb_build_object('found', false);
  end if;
  if target = me then raise exception 'You can''t grant elite to yourself.'; end if;

  select display_name into tname from public.profiles where id = target;
  if exists (select 1 from public.elite_grants where founder_id = me and member_id = target) then
    return jsonb_build_object('found', true, 'name', tname, 'already', true);
  end if;

  select count(*) into used from public.elite_grants where founder_id = me;
  if used >= quota then
    raise exception 'You have used all % of your elite memberships.', quota;
  end if;

  insert into public.elite_grants (founder_id, member_id) values (me, target);
  perform public.grant_comp_entitlement(target, 'comp:elite');
  return jsonb_build_object('found', true, 'name', tname, 'already', false);
end; $$;
grant execute on function public.grant_elite(text) to authenticated;

create or replace function public.my_elite_grants()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'quota', public.elite_quota_for(auth.uid()),
    'used', (select count(*) from public.elite_grants where founder_id = auth.uid()),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'username', p.username,
        'belt_rank', p.belt_rank, 'rating', p.rating, 'granted_at', g.created_at
      ) order by g.created_at desc)
      from public.elite_grants g
      join public.profiles p on p.id = g.member_id
      where g.founder_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.my_elite_grants() to authenticated;

-- Claw a gym account back. Elite comps are only removed from members with no
-- SURVIVING grant from another patron (entitlements is one row per user, but a
-- member can be granted by several patrons - deleting blindly would strip a
-- founder's legitimate grant). participating flips back on so the person can
-- subscribe and compete as a normal member afterward.
create or replace function public.revoke_gym_account(p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.entitlements e
   where e.user_id in (select member_id from public.elite_grants where founder_id = p_profile)
     and e.source = 'comp' and e.product_id = 'comp:elite'
     and not exists (
       select 1 from public.elite_grants g2
       where g2.member_id = e.user_id and g2.founder_id <> p_profile
     );
  delete from public.elite_grants where founder_id = p_profile;
  delete from public.entitlements where user_id = p_profile and source = 'comp' and product_id = 'comp:gym';
  update public.profiles
     set is_gym_account = false, gym_verified = false, participating = true
   where id = p_profile;
  update public.gym_applications set status = 'denied', note = 'Revoked', decided_at = now(), decided_by = auth.uid()
   where profile_id = p_profile and status = 'approved';
end; $$;
grant execute on function public.revoke_gym_account(uuid) to authenticated;

-- Same shared-entitlement bug existed in the original revoke_elite: only pull
-- the comp when no other patron still grants this member.
create or replace function public.revoke_elite(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from public.elite_grants where founder_id = me and member_id = p_member) then
    raise exception 'You did not grant this member elite access.';
  end if;
  delete from public.elite_grants where founder_id = me and member_id = p_member;
  -- Only remove the comp we granted (leaves a real store subscription untouched,
  -- and leaves the comp in place while another patron's grant survives).
  delete from public.entitlements e
   where e.user_id = p_member and e.source = 'comp' and e.product_id = 'comp:elite'
     and not exists (select 1 from public.elite_grants g2 where g2.member_id = p_member);
end; $$;
grant execute on function public.revoke_elite(uuid) to authenticated;

-- Invite-link plumbing (elite-invites.sql) was founders-only with a hardcoded
-- quota of 10; verified gyms share it with their quota of 4.
create or replace function public.elite_slots_left(p_founder uuid)
returns integer language sql stable security definer set search_path = public as $$
  select public.elite_quota_for(p_founder)
    - (select count(*) from public.elite_grants where founder_id = p_founder)
    - (select count(*) from public.elite_invite_codes
         where grantor_id = p_founder and claimed_by is null and expires_at > now());
$$;

create or replace function public.mint_elite_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); gen text; tries int := 0;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no O/0/1/I
begin
  if public.elite_quota_for(me) = 0 then
    raise exception 'Only founding members and verified gyms can create elite invites.';
  end if;
  if public.elite_slots_left(me) <= 0 then
    raise exception 'You have no elite slots left (all % are used or reserved).', public.elite_quota_for(me);
  end if;
  loop
    gen := '';
    for i in 1..8 loop
      gen := gen || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.elite_invite_codes where code = gen);
    tries := tries + 1; if tries > 15 then raise exception 'Could not allocate a code, try again.'; end if;
  end loop;
  insert into public.elite_invite_codes (grantor_id, code) values (me, gen);
  return gen;
end; $$;
grant execute on function public.mint_elite_invite_code() to authenticated;

-- Verified gyms are entitled BY FLAG, not just by comp row. This covers the
-- gym that started a store trial while waiting for approval: the comp can't be
-- written over an active paid row, but access must survive the trial lapsing.
create or replace function public.has_active_entitlement(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user
      and (
        e.source = 'comp'                                    -- comp never expires
        or e.status = 'grace'                                -- billing retry runs AFTER expires_at; the store
                                                             -- clears the flag when retries are exhausted
        or (
          e.status = 'active'
          and (e.expires_at is null or e.expires_at > now())
        )
      )
  ) or exists (
    select 1 from public.profiles p
    where p.id = p_user and p.is_gym_account and p.gym_verified
  );
$$;
grant execute on function public.has_active_entitlement(uuid) to authenticated;

-- ---- Hard stop: gym accounts never COMPETE ----------------------------------
-- Refereeing stays allowed: the gym is the organizer, and recording a hosted
-- tournament bout (record_bout_result) inserts a match with the host as the
-- fallback referee - blocking that would break gym-run tournaments.

create or replace function public.block_gym_account_matches()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.profiles
    where id in (new.challenger_id, new.opponent_id) and is_gym_account
  ) then
    raise exception 'Gym accounts cannot compete in matches.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_block_gym_matches on public.matches;
create trigger trg_block_gym_matches
  before insert on public.matches
  for each row execute function public.block_gym_account_matches();

notify pgrst, 'reload schema';
select 'gym accounts installed' as ok;
