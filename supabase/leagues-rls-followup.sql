-- ============================================================================
-- Roll for Rating -- Batch 5: two holes leagues-hardening.sql left behind
--
-- RUN AFTER leagues-hardening.sql. Safe to re-run. THIS FILE OWNS leagues_read
-- and adds a column-lock trigger to league_members; re-running
-- leagues-hardening.sql reverts leagues_read until this file is re-run.
-- ============================================================================

set lock_timeout = '5s';

-- ---- 1. The invite branch of leagues_read never matched ---------------------
-- leagues-hardening.sql:48-49 reads:
--     exists (select 1 from public.league_invites li
--              where li.league_id = id and li.invited_user = auth.uid() ...)
-- Inside that subquery the unqualified `id` binds to league_invites.id (the
-- INNER table wins), not leagues.id, so the test was effectively
-- `li.league_id = li.id` - comparing a league id to the invite's own uuid,
-- which is never true. Net effect: a member invited to a PRIVATE league could
-- not see the league they were invited to, so the invite was unusable.
--
-- The sibling league_members branch on the line above is fine by luck:
-- league_members has no `id` column (leagues.sql:50-58), so `id` there does
-- resolve to leagues.id. Both are qualified explicitly now so neither depends
-- on which columns a joined table happens to have.
drop policy if exists "leagues_read" on public.leagues;
create policy "leagues_read" on public.leagues for select to authenticated
  using (
    visibility = 'open'
    or created_by = auth.uid()
    or exists (select 1 from public.league_members m
                where m.league_id = public.leagues.id and m.user_id = auth.uid())
    or exists (select 1 from public.league_invites li
                where li.league_id = public.leagues.id
                  and li.invited_user = auth.uid() and li.status = 'pending')
  );

-- ---- 2. A member could move their own membership into ANY league -----------
-- league_members_update (leagues-hardening.sql:70-79) constrains WHO the row
-- belongs to and blocks self-promotion, but a Postgres UPDATE policy cannot
-- compare OLD to NEW, so nothing stopped a member editing their own row's
-- league_id: point it at a PRIVATE league and you are a member of it, with the
-- join_code and full roster now readable. joined_week is the same shape - it
-- drives back-generated fixture pairing, so editing it retro-pairs you into
-- weeks you were never in.
--
-- Column-locking therefore has to be a trigger. The league creator is still
-- allowed to edit rows (that is how the organizer bootstrap and role changes
-- work); everyone else may only touch their own row's mutable fields.
create or replace function public._lock_league_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.leagues l
              where l.id = old.league_id and l.created_by = auth.uid()) then
    return new;                       -- the creator may reshape their own league
  end if;
  if new.league_id is distinct from old.league_id
     or new.user_id is distinct from old.user_id
     or new.joined_week is distinct from old.joined_week
     or new.role is distinct from old.role then
    raise exception 'You can only change your own membership settings in this league';
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_league_membership on public.league_members;
create trigger trg_lock_league_membership
  before update on public.league_members
  for each row execute function public._lock_league_membership();

revoke execute on function public._lock_league_membership() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ---- Post-install diagnostics ----------------------------------------------
-- invite_branch_fixed: expect true (the policy now references leagues.id).
-- membership_lock: expect 1.
-- orphan_memberships: rows whose league no longer exists - a symptom of the
--   league_id rewrite above having been used. Expect 0.
select
  (select pg_get_expr(polqual, polrelid) like '%leagues.id%' from pg_policy
    where polrelid = 'public.leagues'::regclass and polname = 'leagues_read') as invite_branch_fixed,
  (select count(*) from pg_trigger
    where tgrelid = 'public.league_members'::regclass
      and tgname = 'trg_lock_league_membership') as membership_lock,
  (select count(*) from public.league_members m
    where not exists (select 1 from public.leagues l where l.id = m.league_id)) as orphan_memberships,
  'leagues-rls-followup installed' as ok;
