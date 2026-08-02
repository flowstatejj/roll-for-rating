-- ============================================================================
-- Roll for Rating -- Batch 4: minor PII + tournament state machine
--
-- RUN AFTER kid-challenges.sql, managed-juniors.sql, tournaments-pro.sql and
-- tournament-complete.sql. Safe to re-run.
--
-- THIS FILE OWNS profiles_read_visible (also defined in kid-challenges.sql) and
-- complete_tournament (also in tournament-complete.sql). Re-running either of
-- those reverts this file's half until this one is re-run.
-- ============================================================================

set lock_timeout = '5s';

-- ---- 1. A one-sided challenge must not unlock a child's full profile -------
-- profiles_read_visible (kid-challenges.sql:129-147) grants read on a junior's
-- WHOLE row - exact birthdate, gym, city, weight_lbs, gender - to any guardian
-- who has a match_requests row touching that child. Nothing required the other
-- side to agree, and creating a request is a normal in-app action, so any
-- guardian could point a challenge at any kid on the kids board and unlock that
-- child's personal details on demand. No notification, no acceptance, nothing
-- for the other parent to approve.
--
-- The fix keeps the feature (two families who ARE arranging a match can still
-- see each other's kid) but requires the request to be ACCEPTED, which is a
-- deliberate act by the receiving guardian. A real match linking the two
-- juniors still unlocks it, as before.
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or age_tier = 'adult'
    or (age_tier = 'teen' and consent_status = 'verified')
    or (gym_id is not null and gym_id = public.my_gym_id())
    or managed_by = auth.uid()
    or exists (
      select 1 from public.match_requests mr
      where mr.status = 'accepted'
        and ((mr.from_junior = public.profiles.id and public.is_my_junior(mr.to_junior))
          or (mr.to_junior   = public.profiles.id and public.is_my_junior(mr.from_junior)))
    )
    or exists (
      select 1 from public.matches m
      where (m.challenger_id = public.profiles.id or m.opponent_id = public.profiles.id)
        and (public.is_my_junior(m.challenger_id) or public.is_my_junior(m.opponent_id))
    )
  );

-- NOTE, still open and deliberately NOT changed here: the
-- `gym_id = my_gym_id()` arm above means anyone who joins a gym can read every
-- child at that gym, and gym membership is self-service. Narrowing it needs a
-- product decision about what gym-mates should see, so it stays a known gap
-- rather than a silent behaviour change mid-batch.

-- ---- 2. "Complete" must actually complete the tournament -------------------
-- complete_tournament (tournament-complete.sql:11-19) flipped statuses but
-- nothing enforced them: record_bout_result / record_subbout never look at
-- tournaments.status, so a completed event kept settling bouts and moving real
-- ROR afterwards. It was also a one-way door - no way to reopen an event closed
-- by a mis-tap, on an event whose bracket is otherwise finished.
create or replace function public.complete_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can complete the tournament';
  end if;
  update public.tournament_divisions set status = 'complete' where tournament_id = p_tid;
  update public.tournaments set status = 'complete' where id = p_tid;
end; $$;

-- Reopen a tournament closed by mistake. Same authority as completing it.
create or replace function public.reopen_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can reopen the tournament';
  end if;
  update public.tournaments set status = 'running' where id = p_tid;
  -- Only divisions with unfinished bouts go back to running; fully scored ones
  -- stay complete so reopening does not resurrect a settled division.
  update public.tournament_divisions d
     set status = 'running'
   where d.tournament_id = p_tid
     and exists (
       select 1 from public.tournament_bouts b
       where b.division_id = d.id and b.status not in ('done', 'bye')
     );
end; $$;

-- The actual enforcement: a completed event stops accepting results. A trigger
-- rather than an edit to each recorder, because record_bout_result,
-- record_subbout and any future recorder all write tournament_bouts, and a
-- guard added to one body is a guard the next caller forgets.
create or replace function public._block_bouts_on_complete_tournament()
returns trigger language plpgsql set search_path = public as $$
declare tstatus text;
begin
  -- Only care when a bout is being SCORED (status/winner/result changing).
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.winner is not distinct from new.winner
     and old.result is not distinct from new.result then
    return new;
  end if;
  select status into tstatus from public.tournaments where id = new.tournament_id;
  if tstatus = 'complete' then
    raise exception 'This tournament is marked complete. Reopen it before recording more bouts.';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_bouts_on_complete_tournament on public.tournament_bouts;
create trigger trg_block_bouts_on_complete_tournament
  before update on public.tournament_bouts
  for each row execute function public._block_bouts_on_complete_tournament();

revoke execute on function public._block_bouts_on_complete_tournament() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('complete_tournament', 'reopen_tournament')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---- Post-install diagnostics ----------------------------------------------
-- kid_unlock_requires_accepted: expect true. False means the one-sided
--   challenge PII unlock is still live.
-- complete_guard: expect 1 (the trigger exists).
-- open_pending_requests: informational - one-sided requests that no longer
--   unlock anything. Nothing to do, but it shows how much the old policy leaked.
select
  (select pg_get_expr(polqual, polrelid) like '%accepted%' from pg_policy
    where polrelid = 'public.profiles'::regclass and polname = 'profiles_read_visible'
  ) as kid_unlock_requires_accepted,
  (select count(*) from pg_trigger
    where tgrelid = 'public.tournament_bouts'::regclass
      and tgname = 'trg_block_bouts_on_complete_tournament') as complete_guard,
  (select count(*) from public.match_requests where status = 'pending') as open_pending_requests,
  'minors-and-tournament-state installed' as ok;
