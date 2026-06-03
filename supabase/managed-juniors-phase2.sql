-- ============================================================================
-- Roll for Rating — Managed juniors [Phase 2]: compete on a junior's behalf
-- Run AFTER managed-juniors.sql (Phase 1). Safe to re-run.
--
-- Lets a guardian create / accept / decline / cancel matches for the under-14
-- juniors they manage, from their own signed-in session. The referee is always
-- a real logged-in user; juniors never referee. (Phase 1 already blocks a
-- guardian from refereeing their own junior's match.)
-- ============================================================================

-- Helper: is profile `p` a junior managed by the current user? (definer →
-- no RLS recursion when used inside policies / other functions.)
create or replace function public.is_my_junior(p uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = p and managed_by = auth.uid()) $$;

-- --- Create a match where the challenger is me OR a junior I manage ---------
drop policy if exists "matches_insert_as_challenger" on public.matches;
create policy "matches_insert_as_challenger" on public.matches
  for insert to authenticated
  with check (challenger_id = auth.uid() or public.is_my_junior(challenger_id));

-- --- Accept / decline as the opponent OR that opponent's guardian -----------
create or replace function public.respond_to_match(p_match_id uuid, p_accept boolean)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.opponent_id <> auth.uid() and not public.is_my_junior(m.opponent_id) then
    raise exception 'Only the opponent (or their guardian) can respond';
  end if;
  if m.status <> 'pending_opponent' then raise exception 'Match is no longer pending'; end if;

  update public.matches
     set status = case when p_accept then 'pending_referee'::match_status else 'declined'::match_status end
   where id = p_match_id
   returning * into m;
  return m;
end;
$$;

-- --- Cancel as a competitor OR a competitor's guardian ----------------------
create or replace function public.cancel_match(p_match_id uuid)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id)
     and not public.is_my_junior(m.challenger_id)
     and not public.is_my_junior(m.opponent_id) then
    raise exception 'Only a competitor (or their guardian) can cancel';
  end if;
  if m.status not in ('pending_opponent', 'pending_referee') then
    raise exception 'Match can no longer be cancelled';
  end if;

  update public.matches set status = 'cancelled' where id = p_match_id returning * into m;
  return m;
end;
$$;
