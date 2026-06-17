-- ============================================================================
-- Roll for Rating — Elite memberships
-- Each founding member can grant up to 10 complimentary "elite" memberships that
-- give free access to the app (a comp entitlement). Run in the Supabase SQL
-- editor after subscriptions.sql + admin-founders.sql. Safe to re-run.
-- ============================================================================

create table if not exists public.elite_grants (
  founder_id  uuid not null references public.profiles(id) on delete cascade,
  member_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (founder_id, member_id),
  constraint no_self_grant check (founder_id <> member_id)
);
create index if not exists elite_grants_member_idx on public.elite_grants (member_id);

alter table public.elite_grants enable row level security;
-- A founder can read their own grants; all writes go through the RPCs below.
drop policy if exists "elite_grants_select_own" on public.elite_grants;
create policy "elite_grants_select_own" on public.elite_grants for select to authenticated
  using (founder_id = auth.uid());

-- How many elite memberships each founder may give out.
create or replace function public.elite_quota() returns integer language sql immutable as $$ select 10 $$;

-- A founding member grants an elite (free-access) membership by email. The
-- target must already have an account. Idempotent per (founder, member).
create or replace function public.grant_elite(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid; used int; tname text;
begin
  if not exists (select 1 from public.profiles where id = me and is_founding_member) then
    raise exception 'Only founding members can grant elite memberships.';
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
  if used >= public.elite_quota() then
    raise exception 'You have used all % of your elite memberships.', public.elite_quota();
  end if;

  insert into public.elite_grants (founder_id, member_id) values (me, target);
  perform public.grant_comp_entitlement(target, 'comp:elite');
  return jsonb_build_object('found', true, 'name', tname, 'already', false);
end; $$;
grant execute on function public.grant_elite(text) to authenticated;

-- A founder revokes an elite membership they granted (removes the free access).
create or replace function public.revoke_elite(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from public.elite_grants where founder_id = me and member_id = p_member) then
    raise exception 'You did not grant this member elite access.';
  end if;
  delete from public.elite_grants where founder_id = me and member_id = p_member;
  -- Only remove the comp we granted (leaves a real Apple subscription untouched).
  delete from public.entitlements
   where user_id = p_member and source = 'comp' and product_id = 'comp:elite';
end; $$;
grant execute on function public.revoke_elite(uuid) to authenticated;

-- The caller's elite members + quota usage, for the management screen.
create or replace function public.my_elite_grants()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'quota', public.elite_quota(),
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

notify pgrst, 'reload schema';
select 'elite-memberships installed' as ok;
