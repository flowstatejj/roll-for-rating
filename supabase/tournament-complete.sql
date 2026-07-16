-- ============================================================================
-- Roll for Rating - complete_tournament (host closes out an event)
-- Run in the Supabase SQL editor AFTER tournaments-pro.sql. Safe to re-run.
--
-- Nothing previously ever set a tournament (or its divisions) to 'complete':
-- there is no client UPDATE policy on tournaments, so a finished event stayed
-- "Live" forever and never moved to the Completed section of the list. This
-- host-gated RPC is the one and only status-complete transition.
-- ============================================================================

create or replace function public.complete_tournament(p_tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_host(p_tid) then
    raise exception 'Only the host can complete the tournament';
  end if;
  update public.tournament_divisions set status = 'complete' where tournament_id = p_tid;
  update public.tournaments set status = 'complete' where id = p_tid;
end; $$;

grant execute on function public.complete_tournament(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'tournament complete action installed' as ok;
