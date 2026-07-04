-- ============================================================================
-- Roll for Rating - Elite invite links (shareable)
-- A founding member mints an invite code they can text/email to a friend; the
-- friend redeems it (captured at sign-up, or pasted in-app) and gets elite (free)
-- access on the spot. Codes draw from the same 10-per-founder elite quota as
-- grant_elite: an outstanding unclaimed code RESERVES a slot, so a shared code
-- never fails at redemption for quota reasons. Run after elite-memberships.sql.
-- Safe to re-run.
-- ============================================================================

create table if not exists public.elite_invite_codes (
  id          uuid primary key default gen_random_uuid(),
  grantor_id  uuid not null references public.profiles(id) on delete cascade,
  code        text not null unique,
  claimed_by  uuid references public.profiles(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '90 days'
);
create index if not exists elite_invite_grantor_idx on public.elite_invite_codes (grantor_id);
create index if not exists elite_invite_claimed_idx on public.elite_invite_codes (claimed_by);

alter table public.elite_invite_codes enable row level security;
-- Grantor sees their own codes; a redeemer sees one they claimed. Writes go
-- through the RPCs below.
drop policy if exists "elite_invite_select" on public.elite_invite_codes;
create policy "elite_invite_select" on public.elite_invite_codes for select to authenticated
  using (grantor_id = auth.uid() or claimed_by = auth.uid());

-- Remaining elite slots: quota minus granted members minus outstanding unclaimed
-- (unexpired) codes (reserved slots).
create or replace function public.elite_slots_left(p_founder uuid)
returns integer language sql stable security definer set search_path = public as $$
  select public.elite_quota()
    - (select count(*) from public.elite_grants where founder_id = p_founder)
    - (select count(*) from public.elite_invite_codes
         where grantor_id = p_founder and claimed_by is null and expires_at > now());
$$;

-- Mint a shareable elite invite code (reserves a slot). Founders only.
create or replace function public.mint_elite_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); gen text; tries int := 0;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no O/0/1/I
begin
  if not exists (select 1 from public.profiles where id = me and is_founding_member) then
    raise exception 'Only founding members can create elite invites.';
  end if;
  if public.elite_slots_left(me) <= 0 then
    raise exception 'You have no elite slots left (all % are used or reserved).', public.elite_quota();
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

-- Redeem an elite invite code -> the caller gets elite (comp:elite). Once per user.
create or replace function public.redeem_elite_invite_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.elite_invite_codes; gname text; used int;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if exists (select 1 from public.entitlements
             where user_id = me and source='comp' and product_id='comp:elite') then
    return jsonb_build_object('ok', false, 'reason', 'already_elite');
  end if;

  select * into c from public.elite_invite_codes
    where code = upper(btrim(p_code)) and claimed_by is null and expires_at > now()
    for update;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid_or_used'); end if;
  if c.grantor_id = me then return jsonb_build_object('ok', false, 'reason', 'own_code'); end if;

  -- Defensive quota check (the reservation should already guarantee a slot).
  select count(*) into used from public.elite_grants where founder_id = c.grantor_id;
  if used >= public.elite_quota() then
    return jsonb_build_object('ok', false, 'reason', 'grantor_full');
  end if;

  update public.elite_invite_codes set claimed_by = me, claimed_at = now() where id = c.id;
  insert into public.elite_grants (founder_id, member_id) values (c.grantor_id, me)
    on conflict (founder_id, member_id) do nothing;
  perform public.grant_comp_entitlement(me, 'comp:elite');
  select display_name into gname from public.profiles where id = c.grantor_id;
  return jsonb_build_object('ok', true, 'grantor_name', gname);
end; $$;
grant execute on function public.redeem_elite_invite_code(text) to authenticated;

-- The caller's outstanding invite codes + slots left, for the elite screen.
create or replace function public.my_elite_invite_codes()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slots_left', public.elite_slots_left(auth.uid()),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'claimed', claimed_by is not null,
        'created_at', created_at, 'expires_at', expires_at
      ) order by created_at desc)
      from public.elite_invite_codes
      where grantor_id = auth.uid() and expires_at > now()
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.my_elite_invite_codes() to authenticated;

notify pgrst, 'reload schema';
select 'elite-invites installed' as ok;
