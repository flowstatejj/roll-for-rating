-- ============================================================================
-- Roll for Rating - auto mat assignment + mat/referee hardening
-- Run in the Supabase SQL editor AFTER tournaments-pro.sql and
-- tournament-divisions.sql. Safe to re-run.
--
-- *** OWNERSHIP NOTE ***
-- THIS FILE OWNS assign_bout_mat and set_mat_referee (both also defined in
-- tournaments-pro.sql - if that file is ever re-run, re-run THIS file after).
--
-- auto_assign_mats rules:
--   * Division events: each generated DIVISION is pinned to one mat (divisions
--     in creation order, mats in number order, round-robin when there are more
--     divisions than mats). A division never hops mats, and re-runs are stable:
--     the pin enumerates every division that ever generated bouts, so finishing
--     a division does not reshuffle the others.
--   * Legacy no-division events: bouts cycle across mats within each round.
--   * Bouts keep a hand-set referee; otherwise they inherit the mat's referee.
--     Bouts being fought right now (status 'live') and finished/bye bouts are
--     never touched.
--
-- REST TIME, honestly: playing a division's list top-to-bottom gives everyone
-- a full round of rest between rounds, with ONE exception no single-mat
-- schedule can avoid: the final follows the last semifinal (its winner just
-- fought). Same for bye-collapsed early rounds with only one real bout. The
-- host controls the clock - pause before finals, or run them as a block.
-- ============================================================================

create or replace function public.auto_assign_mats(p_tid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mat_ids  uuid[];
  nmats    int;
  d        record;
  di       int := 0;
  m        uuid;
  assigned int := 0;
  cnt      int;
begin
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can assign mats';
  end if;

  perform public._ensure_mats(p_tid);

  select array_agg(id order by mat_no) into mat_ids
  from public.tournament_mats where tournament_id = p_tid;
  nmats := coalesce(array_length(mat_ids, 1), 0);
  if nmats = 0 then return jsonb_build_object('ok', false, 'reason', 'no_mats'); end if;

  -- Division events: pin each GENERATED division to one mat. Enumerating every
  -- division that has bouts (any status) keeps the division->mat map stable for
  -- the whole event, even as divisions finish.
  for d in
    select dv.id from public.tournament_divisions dv
    where dv.tournament_id = p_tid
      and exists (select 1 from public.tournament_bouts b where b.division_id = dv.id)
    order by dv.created_at, dv.id
  loop
    m := mat_ids[1 + (di % nmats)];
    di := di + 1;
    update public.tournament_bouts b
       set mat_id = m,
           referee_id = coalesce(b.referee_id,
             (select referee_id from public.tournament_mats where id = m))
     where b.tournament_id = p_tid
       and b.division_id = d.id
       and b.status = 'pending';
    get diagnostics cnt = row_count;
    assigned := assigned + cnt;
  end loop;

  -- Legacy no-division bouts: cycle across mats within each round by position.
  update public.tournament_bouts b
     set mat_id = mat_ids[1 + ((b.position - 1) % nmats)],
         referee_id = coalesce(b.referee_id,
           (select referee_id from public.tournament_mats
             where id = mat_ids[1 + ((b.position - 1) % nmats)]))
   where b.tournament_id = p_tid
     and b.division_id is null
     and b.status = 'pending';
  get diagnostics cnt = row_count;
  assigned := assigned + cnt;

  return jsonb_build_object('ok', true, 'assigned', assigned, 'mats', nmats);
end; $$;

grant execute on function public.auto_assign_mats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- assign_bout_mat (owner) - manual per-bout move. HARDENED: refuses finished
-- bouts (the old version flipped done bouts back to 'live', which bypassed
-- record_bout_result's double-record guard - a stale second device could
-- re-settle a bout; on a bye it stranded 'live' forever and blocked the
-- champion card). Keeps a hand-set bout referee; inherits the mat's otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.assign_bout_mat(p_bout uuid, p_mat uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; st text; ref uuid;
begin
  select tournament_id, status into tid, st from public.tournament_bouts where id = p_bout;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can assign mats'; end if;
  if st not in ('pending', 'live') then raise exception 'Bout already finished'; end if;
  select referee_id into ref from public.tournament_mats where id = p_mat;
  update public.tournament_bouts
     set mat_id = p_mat,
         referee_id = coalesce(referee_id, ref),
         status = 'live'
   where id = p_bout;
end; $$;

grant execute on function public.assign_bout_mat(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_mat_referee (owner) - now CASCADES to that mat's unfinished bouts whose
-- referee came from the mat, so a replaced referee does not keep record rights
-- via stale per-bout stamps.
-- ---------------------------------------------------------------------------
create or replace function public.set_mat_referee(p_mat uuid, p_ref uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; old_ref uuid;
begin
  select tournament_id, referee_id into tid, old_ref from public.tournament_mats where id = p_mat;
  if tid is null then raise exception 'Mat not found'; end if;
  if not public.is_tournament_host(tid) then raise exception 'Only the host can set referees'; end if;
  update public.tournament_mats set referee_id = p_ref where id = p_mat;
  update public.tournament_bouts
     set referee_id = p_ref
   where mat_id = p_mat
     and status in ('pending', 'live')
     and (referee_id is null or referee_id = old_ref);
end; $$;

grant execute on function public.set_mat_referee(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lock down internal SECURITY DEFINER helpers added since the last hardening
-- pass (Supabase default-grants EXECUTE to anon/authenticated on new public
-- functions). _eligibility_check and the two division-eligibility wrappers take
-- an ARBITRARY user id and bypass profiles RLS - callable directly they form a
-- PII oracle (binary-search anyone's weight/age/gender, minors included).
-- generate_league_division_week has no organizer gate of its own. The loop
-- revokes every overload; the callers are SECURITY DEFINER and keep working.
-- (harden-internal-functions.sql's list is extended to match - re-running
-- either file is safe.)
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        '_eligibility_check', '_division_eligibility', '_league_division_eligibility',
        'generate_league_division_week',
        '_gen_round_robin', '_gen_single_elim', '_advance_bye', '_advance_winner',
        '_division_seeds', '_tournament_seeds', '_settle_match'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
select 'auto mats + mat hardening installed' as ok;
