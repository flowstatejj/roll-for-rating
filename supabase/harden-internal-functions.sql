-- ============================================================================
-- Roll for Rating — Security hardening: lock down internal SECURITY DEFINER
-- helpers so they are NOT callable directly by app users via PostgREST.
--
-- Postgres grants EXECUTE to PUBLIC on new functions by default, and Supabase
-- additionally grants it to anon/authenticated in the public schema, which
-- PostgREST then exposes as /rest/v1/rpc/<fn>. Any SECURITY DEFINER helper that
-- mutates data and lacks its own caller check is therefore a privilege-
-- escalation hole (e.g. generating brackets, advancing bouts, or settling
-- matches on someone else's behalf).
--
-- Every function below is an internal helper (underscore-prefixed convention),
-- called ONLY from other SECURITY DEFINER functions — which run as their owner
-- (postgres) and so keep working after these revokes. Verified 2026-07-02 that
-- none are referenced by the client (no supabase.rpc('_...') anywhere in src/).
--
-- Run AFTER tournaments-pro.sql and tournament-divisions.sql. Safe to re-run.
-- ============================================================================

-- Revoke EXECUTE on EVERY overload of each internal helper. Looping over pg_proc
-- (instead of hand-listing signatures) is deliberate: several of these are
-- overloaded and a hand-written list WILL miss one. In particular _settle_match
-- has BOTH a 5-arg and a 6-arg (p_sub_category) signature, and the tournament
-- generators have base + division-aware variants — a per-signature revoke of the
-- 5-arg _settle_match left the 6-arg one publicly callable (force-settle any
-- match). This catches all present and future overloads. grant_comp_entitlement
-- is included defensively (also revoked inline in subscriptions.sql).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        '_settle_match', '_advance_bye', '_advance_winner', '_division_seeds',
        '_ensure_mats', '_gen_round_robin', '_gen_single_elim', '_tournament_seeds',
        '_may_record', 'grant_comp_entitlement',
        -- 2026-07-16: divisions-era internals. The eligibility helpers take an
        -- ARBITRARY user id and bypass profiles RLS (PII oracle if callable);
        -- generate_league_division_week has no organizer gate of its own.
        '_eligibility_check', '_division_eligibility', '_league_division_eligibility',
        'generate_league_division_week',
        -- 2026-07-17: team-league playoff internals (league-team-playoff.sql).
        -- Both mutate bracket state with no caller gate; must not be client-callable.
        '_advance_league_playoff', '_gen_league_playoff_bracket'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- ============================================================================
-- matches INSERT column lockdown (mirrors the profiles pattern in schema.sql).
--
-- The matches INSERT policy only checks challenger_id = auth.uid(), with NO
-- column restriction — so a client could insert a row with a forged status,
-- winner_id, result, result_proposed_by, completed_at or *_rating_after and
-- then "confirm" it, stealing rating/wager from users who never accepted a
-- match and minting quest/submission rewards. All legitimate state changes go
-- through SECURITY DEFINER functions (owner-run, unaffected by these grants).
--
-- Restrict a direct client INSERT to exactly the columns the app's createMatch()
-- sets; everything else (status default 'pending_opponent', winner_id, result,
-- ratings, result_proposed_by, completed_at, ...) can no longer be client-set.
-- Run AFTER the migrations that add these columns (public-matches.sql = is_public,
-- leagues.sql = league_id/league_week, match-waive-and-wager.sql = referee_waived
-- / wager). Safe to re-run.
-- ============================================================================
revoke insert on public.matches from authenticated;
grant insert (
  challenger_id, opponent_id, referee_id, referee_waived,
  wager, is_public, league_id, league_week
) on public.matches to authenticated;
