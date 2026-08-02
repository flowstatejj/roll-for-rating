-- ============================================================================
-- Roll for Rating -- Batch 6: tournament correctness
--
-- RUN AFTER safety.sql, avatars.sql, avatars-warrior.sql, tournaments-pro.sql,
-- tournament-divisions.sql and tournament-divisions-v2.sql. Safe to re-run.
--
-- THIS FILE OWNS enforce_avatar_required, enforce_not_blocked and
-- delete_division; re-running their original files reverts this half.
-- ============================================================================

set lock_timeout = '5s';

-- ---- 1. Challenge-flow rules must not brick a bracket bout -----------------
-- record_bout_result INSERTs a real matches row to settle a bout
-- (tournaments-pro.sql:601), so EVERY before-insert trigger on matches fires -
-- including rules written for the one-on-one CHALLENGE flow, where a user picks
-- their own opponent. In a bracket the pairing was decided by the draw, and the
-- fight has already happened on the mat; refusing the RECORD does not prevent
-- anything, it just leaves the bracket stuck with no way forward mid-event.
--
-- Two of them fire in ordinary events:
--   * avatar-required: a host-entered GUEST has no profile photo by
--     construction (tournament-guests.sql), so any bout with a guest on the
--     challenger side was unrecordable.
--   * blocked-pair: two entrants who have blocked each other can still be drawn
--     against each other, and then their bout could never be recorded.
-- Both now skip matches created by a tournament bracket. They still apply in
-- full to a user-initiated challenge, which is where they mean something.
-- Body based on avatars-warrior.sql:16-27, NOT avatars.sql. avatars-warrior.sql
-- supersedes it and accepts a warrior emblem OR a photo. Copying the older
-- photo-only body would lock out every warrior user - which is every MINOR,
-- since minors cannot upload photos by design and choosing a warrior sets
-- avatar_path to null (src/lib/avatars.ts:72). That would be a total outage of
-- match creation for the entire under-18 user base on a live build.
create or replace function public.enforce_avatar_required()
returns trigger language plpgsql security definer set search_path = public as $$
declare has_avatar boolean;
begin
  if new.tournament_id is not null then
    return new;  -- bracket pairing, not a challenge
  end if;
  select (avatar_path is not null and btrim(avatar_path) <> '')
      or (avatar_warrior is not null and btrim(avatar_warrior) <> '')
    into has_avatar from public.profiles where id = new.challenger_id;
  if not coalesce(has_avatar, false) then
    raise exception 'Add a profile avatar before you can compete.';
  end if;
  return new;
end; $$;

-- The bypass is keyed on tournament_id ONLY, deliberately.
-- league_id looks equivalent but is not: harden-internal-functions.sql:74
-- grants INSERT on league_id to authenticated, and no server function ever sets
-- it (the only server-side match insert, tournaments-pro.sql:601, sets
-- tournament_id). So a league_id arm would be client-forgeable: create a
-- throwaway league, insert both parties as members, then insert the match with
-- that league_id - and a blocked user has just forced a challenge notification
-- and a match chat channel onto the person who blocked them. tournament_id is
-- not in the client grant, so the bracket fix is fully preserved without it.
create or replace function public.enforce_not_blocked()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tournament_id is not null then
    return new;  -- the host's draw decided this pairing, not either user
  end if;
  if public.is_blocked_pair(new.challenger_id, new.opponent_id) then
    raise exception 'You can''t start a match with a user you''ve blocked (or who blocked you).';
  end if;
  return new;
end; $$;

-- ---- 2. Deleting a division must not corrupt the standings -----------------
-- delete_division (tournament-divisions-v2.sql:105-113) deleted unconditionally.
-- tournament_bouts cascade with the division, but the matches those bouts
-- SETTLED do not: they keep their tournament_id, so they still feed standings
-- and ROR while the bracket that explains them is gone. Regenerating then
-- double-counts. The trash icon is always visible in the UI, so this was one
-- tap away during a live event.
create or replace function public.delete_division(p_division uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; n_settled int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if tid is null then raise exception 'Division not found'; end if;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can delete a division'; end if;

  select count(*) into n_settled
    from public.tournament_bouts b
   where b.division_id = p_division and b.match_id is not null;
  if n_settled > 0 then
    raise exception 'This division has % recorded bout(s). Deleting it would leave their results counting toward the standings with no bracket to explain them.', n_settled
      using hint = 'division_has_results';
  end if;

  delete from public.tournament_divisions where id = p_division;
end; $$;

-- ---- 3. A division skipped at Generate could never be generated ------------
-- generate_tournament loops the divisions and swallows per-division failures
-- (tournament-divisions.sql), and the app's Generate button disappears once ANY
-- bout exists - so a division that was empty at generate time (or errored) was
-- stranded with no bracket and no way to build one. This exposes a per-division
-- generate the host can call afterwards, guarded so it can never touch a
-- division that already has bouts.
-- A thin wrapper on generate_division, which already checks host, refuses when
-- bouts exist, and raises when there are fewer than 2 seeds. Two things it does
-- NOT do: it returns SILENTLY when a bracket already exists (so the host taps
-- and nothing visibly happens), and it does not know about completed events.
create or replace function public.generate_division_now(p_division uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select tournament_id into tid from public.tournament_divisions where id = p_division;
  if tid is null then raise exception 'Division not found'; end if;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can generate a division'; end if;
  if (select status from public.tournaments where id = tid) = 'complete' then
    raise exception 'This tournament is marked complete. Reopen it first.';
  end if;
  if exists (select 1 from public.tournament_bouts where division_id = p_division) then
    raise exception 'This division already has a bracket';
  end if;

  perform public.generate_division(p_division);
  -- generate_division returns silently if it decided not to build; make that
  -- visible rather than leaving the host tapping a button that does nothing.
  if not exists (select 1 from public.tournament_bouts where division_id = p_division) then
    raise exception 'No bracket was generated - this division needs at least 2 eligible entrants';
  end if;
end; $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('delete_division', 'generate_division_now')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---- Post-install diagnostics ----------------------------------------------
-- event_bypass: expect true (challenge rules now skip event-sourced matches).
-- divisions_without_bracket: divisions with no bouts on an event that is
--   already running - the stranded ones generate_division_now now rescues.
--   Informational.
-- delete_guard: expect true.
select
  -- avatar_ok must be true on BOTH counts: the bracket bypass is present AND
  -- the warrior arm survived. Checking only the bypass would report success
  -- while every minor was locked out of creating a match.
  (select prosrc like '%avatar_warrior%' and prosrc like '%tournament_id is not null%'
     from pg_proc where proname = 'enforce_avatar_required' limit 1) as avatar_ok,
  -- expect true: no league_id arm, which would be client-forgeable.
  (select prosrc not like '%league_id%' from pg_proc
    where proname = 'enforce_not_blocked' limit 1) as block_rule_intact,
  (select prosrc like '%division_has_results%' from pg_proc
    where proname = 'delete_division' limit 1) as delete_guard,
  (select count(*) from public.tournament_divisions d
     join public.tournaments t on t.id = d.tournament_id
    where t.status = 'running'
      and not exists (select 1 from public.tournament_bouts b where b.division_id = d.id)
  ) as divisions_without_bracket,
  'tournament-correctness installed' as ok;
