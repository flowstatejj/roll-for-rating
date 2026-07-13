-- ============================================================================
-- Roll for Rating - GUEST COMPETITORS (non-member entrants for host-run events)
-- Run in the Supabase SQL editor AFTER tournament-divisions-v2.sql AND
-- signup-trigger-consolidated.sql. Safe to re-run.
--
-- NOTE: this file edits the profiles.weight_lbs CHECK (floor 40 -> 20 lbs) so
-- small children can be weighed into kids divisions. If you re-run age-weight.sql
-- after this, re-run this file to restore the lower floor. Also, guest bouts are
-- made rating-neutral in ror-symmetric-stake.sql (is_guest -> casual), so re-run
-- ror-symmetric-stake.sql (which must run LAST anyway) after this file.
--
-- WHY: a gym runs a tournament for kids/adults who are NOT app members. The host
-- needs to enter them manually so they appear in brackets, get bouts recorded,
-- and show in standings - exactly like members.
--
-- DESIGN (guest-as-flagged-profile, deliberately chosen to REUSE the entire
-- proven divisions/bracket/recording/standings engine unchanged):
--   A guest is a normal public.profiles row with is_guest = true and
--   participating = false. Everything downstream keys on profiles.id
--   (division_entrants, tournament_entrants, tournament_bouts, standings), so a
--   guest just works. participating = false hides them from member search and
--   the opponent picker (src/lib/social.ts filters participating).
--
-- *** NO BIRTHDATE ON GUEST PROFILES (important) ***
-- A guest is entered DIRECTLY into a chosen division (the host bypasses
-- eligibility), so a guest never needs a stored birthdate. We deliberately do
-- NOT put a birthdate on the guest profile: doing so would make trg_minor_profile
-- stamp a kid/teen guest is_minor=true, consent_status='pending', which (a) makes
-- enforce_minor_match BLOCK recording every one of that guest's bouts (killing the
-- kids-tournament use case) and (b) makes the profiles_read_visible RLS hide the
-- guest so the live bracket renders '?'. With no birthdate the guest is a plain
-- age_tier='adult' profile that is readable and fully competable at any real age.
-- The division the host picks IS the guest's age/belt/weight bracket.
--
-- HOW a profile gets created without a real signup:
--   profiles.id is FK -> auth.users(id) ON DELETE CASCADE, and the
--   on_auth_user_created trigger builds the profile from raw_user_meta_data. So
--   we insert a minimal auth.users STUB (no usable password, undeliverable
--   .invalid email) and the trigger materializes the guest profile; we then
--   stamp is_guest / participating=false / weight / gender.
--
-- *** THE FRAGILE PART (auth.users insert) ***
-- The insert bypasses GoTrue. It sets the minimal stable column set PLUS the
-- token columns that GoTrue scans into non-nullable Go strings (confirmation_token,
-- recovery_token, email_change_token_new/current, email_change,
-- reauthentication_token) as '' - leaving those NULL is the classic bug that
-- breaks the Supabase Auth "Users" dashboard once such rows exist. The function is
-- SECURITY DEFINER (owner = postgres) so it can write auth.users; callers are gated
-- to the tournament host. Still test create_guest_competitor with ONE guest on prod
-- before seeding many.
--
-- Guest login is impossible: encrypted_password = '' never matches any password
-- hash, and the @guests.rollforrating.invalid address (RFC-2606 reserved TLD) is
-- undeliverable so no magic-link / OTP can ever be requested for it.
-- ============================================================================

-- --- Schema: the guest flag --------------------------------------------------
alter table public.profiles add column if not exists is_guest boolean not null default false;
comment on column public.profiles.is_guest is
  'true = a non-member competitor entered by a tournament host (no real auth).';

-- --- Widen the weight floor so small children can be weighed in --------------
-- The original age-weight.sql floor of 40 lbs silently drops a small child's
-- weight; kids divisions need lower. Only WIDENS validity (20..500), so every
-- existing row still passes. Drop whatever check currently guards weight_lbs, by
-- definition, then re-add the wider one.
do $$
declare cn text;
begin
  for cn in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%weight_lbs%'
  loop
    execute 'alter table public.profiles drop constraint ' || quote_ident(cn);
  end loop;
end $$;
alter table public.profiles
  add constraint profiles_weight_lbs_check
  check (weight_lbs is null or (weight_lbs >= 20 and weight_lbs <= 500));

-- ---------------------------------------------------------------------------
-- create_guest_competitor - host-only. Materializes a guest profile and enters
-- it into the tournament (+ a division, if given). Returns { ok, user_id, name,
-- username }. Weight is applied only within the profiles CHECK (20..500 lbs);
-- gender only if 'male'/'female'; anything else is stored null. No birthdate is
-- stored (see the header note).
-- ---------------------------------------------------------------------------
-- Drop any earlier signature (a pre-release build had a p_birthdate arg) so a
-- defaulted call can never be ambiguous between overloads.
drop function if exists public.create_guest_competitor(uuid, text, uuid, public.belt_rank, date, numeric, text);

create or replace function public.create_guest_competitor(
  p_tid       uuid,
  p_name      text,
  p_division  uuid    default null,
  p_belt      public.belt_rank default 'white',
  p_weight_lbs numeric default null,
  p_gender    text    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  gid      uuid := gen_random_uuid();
  v_name   text := coalesce(nullif(btrim(p_name), ''), 'Guest');
  v_weight numeric := case when p_weight_lbs is not null and p_weight_lbs >= 20 and p_weight_lbs <= 500
                           then p_weight_lbs else null end;
  v_gender text := case when p_gender in ('male','female') then p_gender else null end;
  v_uname  text := 'guest_' || left(replace(gid::text, '-', ''), 12);
begin
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can add guest competitors';
  end if;

  if p_division is not null
     and not exists (select 1 from public.tournament_divisions
                     where id = p_division and tournament_id = p_tid) then
    raise exception 'That division does not belong to this tournament';
  end if;

  -- 1) auth.users stub -> the on_auth_user_created trigger builds the profile
  --    (username uniquified, participating=false). Token columns are set to ''
  --    (never NULL) so the GoTrue admin/dashboard user listing does not break.
  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    reauthentication_token,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    gid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'guest_' || replace(gid::text, '-', '') || '@guests.rollforrating.invalid',
    '',                       -- no usable password
    now(),                    -- pre-confirmed (no email flow)
    now(), now(),
    '', '',                   -- confirmation_token, recovery_token
    '', '', '',               -- email_change_token_new, email_change, email_change_token_current
    '',                       -- reauthentication_token
    '{"provider":"guest","providers":["guest"]}'::jsonb,
    jsonb_build_object(
      'username',      v_uname,
      'display_name',  v_name,
      'belt_rank',     p_belt::text,
      'participating', false
    )
  );

  -- 2) stamp the guest-specific fields (own the invariants rather than trusting
  --    trigger state - handle_new_user has a history of drift on this repo).
  update public.profiles
     set is_guest      = true,
         participating = false,
         weight_lbs    = v_weight,
         gender        = v_gender
   where id = gid;

  -- 3) enter the event (+ division)
  insert into public.tournament_entrants (tournament_id, user_id)
  values (p_tid, gid) on conflict do nothing;

  if p_division is not null then
    insert into public.division_entrants (division_id, user_id)
    values (p_division, gid) on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'user_id', gid, 'name', v_name,
                            'username', (select username from public.profiles where id = gid));
end; $$;

-- ---------------------------------------------------------------------------
-- remove_guest_competitor - host-only. Deletes a guest entirely (auth.users row
-- cascades the profile; division_entrants/tournament_entrants also cascade).
-- Guarded so it can ONLY delete a real guest that belongs to this tournament -
-- never a member - AND refuses once the guest has any recorded match, so a guest
-- can only be removed while fixing a mis-entry (before results exist).
-- NOTE ON CASCADE: matches.challenger_id/opponent_id are ON DELETE CASCADE (the
-- guest's match rows are deleted), while tournament_bouts.a_entrant/b_entrant are
-- ON DELETE SET NULL (structural bout rows survive with a null slot). That is why
-- we forbid removal after any match is recorded - deleting settled matches would
-- orphan the bracket. (Guest bouts are rating-neutral - see ror-symmetric-stake -
-- so no real member's rating is affected either way.)
-- ---------------------------------------------------------------------------
create or replace function public.remove_guest_competitor(p_tid uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can remove guest competitors';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and is_guest) then
    raise exception 'That competitor is not a guest';
  end if;
  if not exists (select 1 from public.tournament_entrants where tournament_id = p_tid and user_id = p_user) then
    raise exception 'That guest is not in this tournament';
  end if;
  if exists (select 1 from public.matches where challenger_id = p_user or opponent_id = p_user) then
    raise exception 'This guest already has recorded bouts and cannot be removed';
  end if;
  delete from auth.users where id = p_user;   -- cascades profile + entrant rows
end; $$;

-- ---------------------------------------------------------------------------
-- division_roster - entrants of one division with the fields a host needs to
-- eyeball seeding (name, belt, gender, weight, rating, guest flag). HOST-ONLY:
-- returns entrants' gender/weight, which for minor MEMBERS is shielded by the
-- profiles_read_visible RLS; a SECURITY DEFINER function bypasses that RLS, so it
-- must be gated to the host or it would leak minors' PII to any authed user.
-- ---------------------------------------------------------------------------
create or replace function public.division_roster(p_division uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; out jsonb;
begin
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if tid is null then return '[]'::jsonb; end if;
  if not public.is_tournament_host(tid) then
    raise exception 'Only the host can view the division roster';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id',      p.id,
      'display_name', p.display_name,
      'belt_rank',    p.belt_rank,
      'gender',       p.gender,
      'weight_lbs',   p.weight_lbs,
      'rating',       p.rating,
      'is_guest',     coalesce(p.is_guest, false)
    ) order by coalesce(p.is_guest,false), p.display_name
  ), '[]'::jsonb) into out
  from public.division_entrants de
  join public.profiles p on p.id = de.user_id
  where de.division_id = p_division;
  return out;
end; $$;

-- ---------------------------------------------------------------------------
-- tournament_guests - every guest entered in an event (host management view).
-- HOST-ONLY for the same PII reason as division_roster.
-- ---------------------------------------------------------------------------
create or replace function public.tournament_guests(p_tid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can view guest competitors';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id',      p.id,
      'display_name', p.display_name,
      'belt_rank',    p.belt_rank,
      'gender',       p.gender,
      'weight_lbs',   p.weight_lbs
    ) order by p.display_name
  ), '[]'::jsonb) into out
  from public.tournament_entrants te
  join public.profiles p on p.id = te.user_id
  where te.tournament_id = p_tid and coalesce(p.is_guest, false);
  return out;
end; $$;

-- --- Grants ------------------------------------------------------------------
grant execute on function public.create_guest_competitor(uuid, text, uuid, public.belt_rank, numeric, text) to authenticated;
grant execute on function public.remove_guest_competitor(uuid, uuid) to authenticated;
grant execute on function public.division_roster(uuid) to authenticated;
grant execute on function public.tournament_guests(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'tournament guests installed' as ok;
