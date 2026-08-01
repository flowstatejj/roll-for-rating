-- ============================================================================
-- Roll for Rating -- Batch 1 security hardening (audit 2026-07-20)
--
-- RUN LAST, after schema.sql, challenges.sql, match-waive-and-wager.sql,
-- match-disputes.sql, leagues.sql, tournaments-pro.sql and ror-symmetric-stake.sql.
-- tournaments-pro.sql is a HARD prerequisite: the DROP POLICY statements in
-- section 3 error out ("relation does not exist") if tournament_teams has not
-- been created yet. Safe to re-run.
--
-- THIS FILE OWNS, and re-running the older files listed below silently reverts
-- that half of it until this file is re-run:
--   * confirm_match_result       <- also defined in leagues.sql, match-waive-and-wager.sql
--   * set_submission_type        <- also defined in submission-hunt.sql
--   * add_team_member            <- also defined in tournaments-pro.sql
--   * the tournament_teams / tournament_team_members RLS policies
--                                <- also defined in tournaments-pro.sql
-- (Function GRANTs survive CREATE OR REPLACE; policies and bodies do not.)
-- One exception to that rule: leagues.sql:250 DROPs the 5-arg
-- record_match_result before creating the 6-arg one, and a DROP + CREATE does
-- NOT preserve the ACL - so re-running schema.sql / challenges.sql /
-- match-waive-and-wager.sql resurrects a 5-arg overload carrying the default
-- anon grant. Re-run this file after any of those.
--
-- Closes the three criticals from the 2026-07-20 audit:
--
--   1. UNILATERAL SETTLEMENT (wager + rating theft), two distinct bugs.
--      a) NULL-proposal: report_match_result's single-report branch
--         (match-disputes.sql:63-66) moves a waived match to
--         'pending_confirmation' but leaves winner_id, result and
--         result_proposed_by NULL. confirm_match_result's self-confirm guard is
--         `auth.uid() = m.result_proposed_by`, which is NULL (not true) when
--         nothing was proposed, so EITHER competitor could settle alone and
--         _settle_match took the decisive ELSE arm, paying stake + wager to the
--         OPPONENT with result NULL.
--      b) ANONYMOUS CALLERS (worse, found in review): Postgres grants EXECUTE to
--         PUBLIC on new functions by default and Supabase exposes public-schema
--         functions to anon via PostgREST. record_match_result,
--         report_match_result and confirm_match_result were NEVER revoked
--         (match-disputes.sql:89 only GRANTs to authenticated, which does not
--         remove the PUBLIC grant). With no JWT, auth.uid() is NULL, so every
--         `if auth.uid() <> ...` / `not in (...)` guard evaluates to NULL, which
--         plpgsql treats as false - no raise - and settlement proceeds. The anon
--         key ships inside the app, so ANY unauthenticated request could settle
--         a match with an attacker-chosen winner. Section 1 revokes anon and
--         adds explicit auth.uid() IS NULL checks.
--
--   2. TOURNAMENT TEAM TABLES WERE CLIENT-WRITABLE.
--      ttiteams_write allowed `for all` with `captain_id = auth.uid()`, so any
--      signed-in user could INSERT a team into ANY event, UPDATE its seed, or
--      DELETE it mid-event (tournament_bouts.a_team/b_team are ON DELETE SET
--      NULL, so deleting blanked live bracket slots). ttmembers_write let
--      anyone add or remove THEMSELVES on any roster. add_team_member had no
--      caller check at all and kept the default PUBLIC EXECUTE (it is not
--      underscore-prefixed, so harden-internal-functions.sql never covered it).
--      The league equivalents (league-teams.sql:55-58) were always
--      read-only-plus-RPC; this brings tournaments in line with them.
--      Verified safe: the app only SELECTs these tables directly; every write
--      already goes through create_tournament_team / add_team_member /
--      auto_balance_teams (src/lib/tournaments.ts:210-238), and there is no
--      team-removal path in the app at all.
-- ============================================================================

-- ---- 0. CLASS FIX: no SECURITY DEFINER function is anon-callable -----------
-- The settlement bug above is one instance of a class. A SECURITY DEFINER
-- function runs as its owner and therefore bypasses RLS, so it MUST authorize
-- the caller itself - but nearly every one of them authorizes with a comparison
-- like `auth.uid() <> x` or `auth.uid() not in (...)`, and for an anonymous
-- caller auth.uid() is NULL, which makes the comparison NULL, which plpgsql
-- treats as false. The guard silently does not fire. A sweep of supabase/*.sql
-- found 39 mutating, auth-guarded, never-revoked functions in this shape,
-- including:
--   respond_to_match / cancel_match (schema.sql)      - accept or kill anyone's match
--   set_match_plan (messages.sql)                     - rewrite any match's meetup
--   post_league_message (push-notifications.sql)      - post to any league
--   set_submission_type (submission-hunt.sql)         - see section 5, RoR exploit
-- Rather than enumerate them (and miss one), revoke EXECUTE from public + anon
-- on EVERY SECURITY DEFINER function in the public schema, with an explicit
-- allowlist for the ones a logged-out user genuinely needs.
--
-- has_function_privilege is checked BEFORE the revoke so the current posture of
-- authenticated AND service_role is preserved exactly: functions they could
-- already call are re-granted, and internal helpers that
-- harden-internal-functions.sql deliberately revoked from authenticated STAY
-- revoked (a blanket re-grant would silently undo that hardening).
-- service_role matters because revoking PUBLIC also strips what service_role
-- inherited through it, and the grade-puzzle edge function calls
-- submit_puzzle_written with the service key (the only edge-function RPC call
-- in the repo). Puzzles are out of scope here - this preserves them untouched.
--
-- Allowlist rationale: username_available is the signup screen's pre-check,
-- called before the account exists (signup-trigger-consolidated.sql:179). It is
-- read-only. It is the ONLY RPC the app calls while logged out - verified by
-- grepping supabase.rpc across src/app/(auth)/.
do $$
declare r record; keep_auth boolean; keep_svc boolean;
  allow text[] := array['username_available'];
begin
  for r in
    select p.oid as oid, p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef                      -- SECURITY DEFINER only
       and not (p.proname = any(allow))
  loop
    keep_auth := has_function_privilege('authenticated', r.oid, 'execute');
    keep_svc  := has_function_privilege('service_role', r.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', r.sig);
    if keep_auth then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    if keep_svc then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

-- ---- 1. confirm_match_result: reject anon + require an actual proposal -----
-- Body copied from the live definition (leagues.sql:388-414) plus the guards.
create or replace function public.confirm_match_result(p_match_id uuid, p_accept boolean)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  -- Defence in depth behind the revoke above: without this, an unauthenticated
  -- caller makes every auth.uid() comparison below NULL (i.e. never raises).
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'pending_confirmation' then raise exception 'No result is awaiting confirmation'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id) then
    raise exception 'Only a competitor can confirm the result';
  end if;

  if p_accept then
    -- A waived match that is merely awaiting the SECOND report has no proposal
    -- on it (winner/result/proposer all NULL). Without this guard the
    -- self-confirm check below is NULL-false and one competitor could settle
    -- the match alone. Dual-report matches settle only through
    -- report_match_result agreement. Kept inside the accept branch so
    -- p_accept = false can still reopen the match (the dispute/withdraw path).
    if m.result_proposed_by is null or m.result is null then
      raise exception 'No result has been proposed yet - the other competitor still has to report theirs.';
    end if;
    if auth.uid() = m.result_proposed_by then
      raise exception 'You logged this result - the other competitor has to confirm it';
    end if;
    return public._settle_match(m.id, m.winner_id, m.result, m.method, m.notes, m.sub_category);
  else
    update public.matches
       set status = 'pending_referee', winner_id = null, result = null,
           method = null, sub_category = null, result_proposed_by = null
     where id = m.id
     returning * into m;
    return m;
  end if;
end; $$;

-- ---- 2. Structural backstop: a completed match must be coherent ------------
-- Deliberately a TRIGGER, not another _settle_match redefinition: _settle_match
-- is already defined in 5 files (leagues.sql:252, match-waive-and-wager.sql:49,
-- ror-mismatch-scaling.sql:26, ror-symmetric-stake.sql:36,
-- tournaments-pro.sql:169) and the last one applied wins, so a guard baked into
-- one body silently disappears when an older file is re-run. A trigger survives
-- every re-run and covers callers we have not thought of.
-- Every legitimate settle path sets status and result in the SAME statement
-- (ror-symmetric-stake.sql:117-125, challenges.sql:101-112), and the only INSERT
-- into matches in the repo (tournaments-pro.sql:601) uses 'pending_referee', so
-- covering INSERT costs nothing and closes the path a future stray
-- `grant insert on public.matches` would otherwise open.
create or replace function public._enforce_settled_result()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT'
          or old.status is distinct from new.status
          or old.result is distinct from new.result
          or old.winner_id is distinct from new.winner_id) then
    if new.result is null then
      raise exception 'Refusing to complete match % with no result', new.id
        using hint = 'A result is required to settle a match.';
    end if;
    if new.result <> 'draw'
       and (new.winner_id is null
            or new.winner_id not in (new.challenger_id, new.opponent_id)) then
      raise exception 'Refusing to complete match %: a decisive result needs a winner who competed in it', new.id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_settled_result on public.matches;
create trigger trg_enforce_settled_result
  before insert or update on public.matches
  for each row execute function public._enforce_settled_result();

-- ---- 3. Tournament team tables: read-only to clients -----------------------
-- Mirrors league_teams / league_team_members (league-teams.sql:55-58): readable
-- by signed-in users, all writes via the SECURITY DEFINER RPCs below (which
-- bypass RLS and authorize the caller themselves).
drop policy if exists "ttiteams_write" on public.tournament_teams;
drop policy if exists "ttmembers_write" on public.tournament_team_members;

drop policy if exists "ttiteams_read" on public.tournament_teams;
create policy "ttiteams_read" on public.tournament_teams for select to authenticated using (true);
drop policy if exists "ttmembers_read" on public.tournament_team_members;
create policy "ttmembers_read" on public.tournament_team_members for select to authenticated using (true);

-- ---- 4. add_team_member: authorize the caller + freeze scored rosters -------
-- Was: no caller check whatsoever. Now host-or-captain, and it refuses to
-- mutate a roster whose bout is already being scored - record_subbout rebuilds
-- the slot-ordered roster array on every call (tournaments-pro.sql:634-635), so
-- changing it mid-bout skips a live fighter or records against the wrong athlete
-- (the same freeze add_league_team_member already has, league-teams.sql:108-115).
create or replace function public.add_team_member(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int; sz int; tid uuid; cap uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select tournament_id, captain_id into tid, cap from public.tournament_teams where id = p_team;
  if tid is null then raise exception 'Team not found'; end if;
  -- coalesce matters: auto_balance_teams creates teams with captain_id NULL
  -- (tournaments-pro.sql:328) and captain_id is ON DELETE SET NULL, so a bare
  -- `cap = auth.uid()` would be NULL - not false - and the guard would not fire.
  if not (public.is_tournament_host(tid) or coalesce(cap = auth.uid(), false)) then
    raise exception 'Only the host or the team captain can add members';
  end if;
  if exists (
    select 1 from public.tournament_bouts b
    where (b.a_team = p_team or b.b_team = p_team)
      and b.status <> 'done'
      and exists (select 1 from public.tournament_subbouts s where s.bout_id = b.id)
  ) then
    raise exception 'Cannot change the roster while a bout is being scored; finish or reset it first';
  end if;
  select team_size into sz from public.tournaments where id = tid;
  select count(*) into n from public.tournament_team_members where team_id = p_team;
  if n >= sz then raise exception 'Team is full (% members)', sz; end if;
  insert into public.tournament_team_members (team_id, user_id, slot)
  values (p_team, p_user, n + 1) on conflict do nothing;
end; $$;

-- (grants are re-asserted in section 6, after every function above exists)

-- ---- 5. set_submission_type: the guard could never fire on a waived match --
-- Original guard (submission-hunt.sql:16) was `if m.referee_id <> auth.uid()`.
-- match-waive-and-wager.sql:36 constrains a waived match to referee_id IS NULL,
-- so on EVERY waived match that comparison is NULL - never true - and the raise
-- never happened. Any user could set submission_type on anyone's waived match.
-- That is not cosmetic: claim_submission_rewards (submission-values.sql:44-77)
-- pays RoR per DISTINCT submission_type on matches the caller won, recording
-- each type once in submission_rewards. The winner of a single waived match
-- could rotate its submission_type through every row of submission_values and
-- claim each one, inflating their rating without bound.
-- This file now OWNS set_submission_type; re-running submission-hunt.sql
-- reverts it.
create or replace function public.set_submission_type(p_match_id uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  -- Referee tags a refereed match; on a waived match (no referee) only the
  -- competitor who logged the result may tag it. is distinct from is NULL-safe.
  if m.referee_waived then
    if m.result_proposed_by is distinct from auth.uid() then
      raise exception 'Only the competitor who logged this result can tag the finish';
    end if;
  elsif m.referee_id is distinct from auth.uid() then
    raise exception 'Only the referee can tag the finish';
  end if;
  update public.matches set submission_type = nullif(trim(p_type), '') where id = p_match_id;
end; $$;

-- ---- 6. Re-assert grants AFTER every definition above ----------------------
-- Section 0 runs before the CREATE OR REPLACEs. Replacing a function preserves
-- its ACL, so section 0's revokes normally survive - but if any function here
-- did NOT already exist, CREATE assigns the default PUBLIC/anon grants and
-- section 0 would have missed it. Re-asserting at the end is order-proof.
-- These are all client-called RPCs that now authorize the caller internally.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('record_match_result', 'report_match_result', 'confirm_match_result',
                         'add_team_member', 'create_tournament_team', 'auto_balance_teams',
                         'set_submission_type')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---- Post-install diagnostics ----------------------------------------------
-- Folded into ONE statement on purpose: the Supabase SQL editor renders only the
-- LAST result set, so separate diagnostic SELECTs would never be seen.
--
-- suspect_settled_matches: expect a count of 0. Anything higher means a match
--   was settled with no result (or a winner who did not compete) BEFORE this
--   file ran, i.e. the unilateral-settlement hole was actually used.
-- outsider_captain_teams: expect a count of 0. Teams whose captain is neither
--   the host nor an entrant of that event. Teams where the captain is a normal
--   entrant are EXCLUDED because team_build = 'captain' events legitimately set
--   captain_id to the entrant (tournaments-pro.sql:293, tournament/[id].tsx:406).
-- anon_callable_definers: expect a count of 0. Any SECURITY DEFINER function in
--   public that anon can still execute, other than the allowlist. A non-zero
--   count means section 0 missed something (e.g. a function created after this
--   file last ran) and the class of bug is back.
select
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname <> 'username_available'
      and has_function_privilege('anon', p.oid, 'execute')
  ) as anon_callable_definers,
  (select count(*) from public.matches
    where status = 'completed'
      and (result is null
           or (result <> 'draw'
               and (winner_id is null or winner_id not in (challenger_id, opponent_id))))
  ) as suspect_settled_matches,
  (select count(*) from public.tournament_teams tt
     join public.tournaments t on t.id = tt.tournament_id
    where tt.captain_id is not null
      and tt.captain_id <> t.host_id
      and not exists (select 1 from public.tournament_entrants e
                       where e.tournament_id = tt.tournament_id
                         and e.user_id = tt.captain_id)
  ) as outsider_captain_teams,
  'settlement-and-teams-hardening installed' as ok;
