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
-- (grant_comp_entitlement and _settle_match are revoked inline in their own
-- files — subscriptions.sql / match-waive-and-wager.sql.)
-- ============================================================================

-- ---- tournaments-pro.sql helpers -------------------------------------------
revoke execute on function public._ensure_mats(uuid) from public, anon, authenticated;
revoke execute on function public._tournament_seeds(uuid) from public, anon, authenticated;
revoke execute on function public._gen_round_robin(uuid, uuid[], boolean) from public, anon, authenticated;
revoke execute on function public._gen_single_elim(uuid, uuid[], boolean, text) from public, anon, authenticated;
revoke execute on function public._advance_bye(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._may_record(public.tournament_bouts) from public, anon, authenticated;
revoke execute on function public._advance_winner(public.tournament_bouts, boolean) from public, anon, authenticated;

-- ---- tournament-divisions.sql overloads (division-aware variants) -----------
revoke execute on function public._gen_round_robin(uuid, uuid[], boolean, uuid) from public, anon, authenticated;
revoke execute on function public._gen_single_elim(uuid, uuid[], boolean, text, uuid) from public, anon, authenticated;
revoke execute on function public._division_seeds(uuid) from public, anon, authenticated;
