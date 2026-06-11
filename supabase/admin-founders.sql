-- ============================================================================
-- Roll for Rating — Admin role + Founding Members
-- Run in the Supabase SQL editor (after schema.sql + subscriptions.sql). Re-runnable.
--
--   • profiles.is_admin            — can manage the app (founding members, etc.)
--   • profiles.is_founding_member  — gold badge everywhere + free access (comp)
--
-- Founding members get a complimentary entitlement (source='comp') so they skip
-- the paywall, reusing the subscription system. Admins flag people by email from
-- the in-app Admin screen.
-- ============================================================================

alter table public.profiles add column if not exists is_admin            boolean not null default false;
alter table public.profiles add column if not exists is_founding_member  boolean not null default false;

-- Badges must be visible to everyone (leaderboards, other profiles).
grant select (is_admin, is_founding_member) on public.profiles to authenticated, anon;

create index if not exists idx_profiles_founder
  on public.profiles (is_founding_member) where is_founding_member;

-- Is the current caller an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to authenticated;

-- Admin-only: set founding-member status for a user id, and grant/revoke the
-- complimentary (free) entitlement to match.
create or replace function public.admin_set_founding_member(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.profiles set is_founding_member = p_on where id = p_user;
  if p_on then
    insert into public.entitlements (user_id, product_id, source, status, expires_at)
    values (p_user, 'comp:founding-member', 'comp', 'active', null)
    on conflict (user_id) do update
      set source='comp', status='active', expires_at=null,
          product_id='comp:founding-member', updated_at=now();
  else
    delete from public.entitlements
      where user_id = p_user and source = 'comp' and product_id = 'comp:founding-member';
  end if;
end; $$;
grant execute on function public.admin_set_founding_member(uuid, boolean) to authenticated;

-- Admin-only: flag a founding member BY EMAIL (what the in-app Admin screen calls).
-- Returns the matched user (or found=false if no account with that email yet).
create or replace function public.admin_make_founding_by_email(p_email text, p_on boolean default true)
returns table (user_id uuid, display_name text, found boolean)
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return query select null::uuid, null::text, false; return;
  end if;
  perform public.admin_set_founding_member(uid, p_on);
  return query select p.id, p.display_name, true from public.profiles p where p.id = uid;
end; $$;
grant execute on function public.admin_make_founding_by_email(text, boolean) to authenticated;

-- Admin-only: list current founding members (for the Admin screen).
create or replace function public.admin_list_founders()
returns table (id uuid, display_name text, username text, belt_rank text, rating int)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.username, p.belt_rank::text, p.rating
  from public.profiles p
  where public.is_admin() and p.is_founding_member
  order by p.display_name;
$$;
grant execute on function public.admin_list_founders() to authenticated;
