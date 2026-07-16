-- ============================================================================
-- Roll for Rating -- Symmetric "smaller ROR" stake (AUTHORITATIVE settlement)
-- Run LAST, after every other file that (re)defines _settle_match:
--   schema.sql, ror-mismatch-scaling.sql, leagues.sql, match-waive-and-wager.sql,
--   tournaments-pro.sql. Safe to re-run.
--
-- This is the single source of truth for how a decisive match moves ROR, and it
-- INTENTIONALLY DIFFERS from the older copies in tournaments-pro.sql /
-- leagues.sql / match-waive-and-wager.sql: this body adds the guest-casual gate
-- (a bout involving an is_guest profile never moves real ROR/W-L). So this file
-- MUST be the last _settle_match definition applied - re-running any older file
-- silently strips the guest gate until this one is re-run.
--
-- There is deliberately NO 5-arg overload anymore (see the DROP below): the
-- 6-arg default covers 5-argument calls, and having both made every 5-arg call
-- ambiguous (Postgres 42725), breaking dispute/dual-report settlement.
--
-- WHY: with classic Elo an upset is worth a lot -- a strong player who loses to a
-- much weaker one sheds a big chunk of ROR but only gains a sliver for winning,
-- so there's no reason to ever roll a lower-rated opponent. That kills
-- cross-rating matchups. (It was also split across two overloads that had
-- drifted: the 5-arg regular/dispute path was still full-K classic Elo.)
--
-- FIX: a decisive match exchanges only the SMALLER swing -- ONE symmetric
-- transfer T = K * E(underdog) (+ wager), clamped to what the loser can actually
-- pay down to the 100 floor. Winner +T, loser -T, so the higher-rated player
-- NEVER gains or loses more than the lower-rated opponent, even at the floor.
--   * Even match -> stake = K*0.5 = 16
--   * 400 gap    -> stake ~= 3
--   * 1000+ gap  -> stake  = 1  (floor)
-- Draws are unchanged (still damped toward the loss side, to discourage
-- stalling). The league/tournament CASUAL fork, the W/L record, and the
-- 100-point floor behave as before.
-- ============================================================================

create or replace function public._settle_match(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_method text, p_notes text, p_sub_category text default null
)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare
  m public.matches; k constant integer := 32;
  c_rating integer; o_rating integer;
  c_score double precision; o_score double precision;
  c_expected double precision; o_expected double precision;
  c_new integer; o_new integer; c_delta integer; o_delta integer;
  mismatch double precision; is_casual boolean; stake integer; transfer integer;
begin
  select * into m from public.matches where id = p_match_id for update;

  is_casual :=
    (m.league_id is not null and coalesce((select not ranked from public.leagues where id = m.league_id), false))
    or (m.tournament_id is not null and coalesce((select not ranked from public.tournaments where id = m.tournament_id), false))
    -- A bout involving a host-entered guest (non-member, belt-seeded phantom) never
    -- moves real ROR/W-L, even in a ranked event - guests can't be used to farm or
    -- tank a real member's rating.
    or exists (select 1 from public.profiles
               where id in (m.challenger_id, m.opponent_id) and coalesce(is_guest, false));

  select rating into c_rating from public.profiles where id = m.challenger_id for update;
  select rating into o_rating from public.profiles where id = m.opponent_id  for update;

  if p_result = 'draw' then
    c_score := 0.0; o_score := 0.0;
  elsif p_winner_id = m.challenger_id then
    c_score := 1.0; o_score := 0.0;
  else
    c_score := 0.0; o_score := 1.0;
  end if;

  c_expected := public.elo_expected(c_rating, o_rating);
  o_expected := public.elo_expected(o_rating, c_rating);
  mismatch := greatest(0.0, 1 - abs(c_rating - o_rating) / 1000.0);

  if p_result = 'draw' then
    -- Draw: damp both toward the loss side (discourages stalling). Unchanged.
    c_delta := round(k * (c_score - c_expected) * mismatch);
    o_delta := round(k * (o_score - o_expected) * mismatch);
    c_new := greatest(100, c_rating + c_delta);
    o_new := greatest(100, o_rating + o_delta);
  else
    -- Decisive: ONE symmetric transfer T = K*E(underdog) + wager, clamped to what
    -- the loser can actually pay down to the 100 floor. Winner +T, loser -T, so the
    -- higher-rated player NEVER gains or loses more than the lower-rated opponent.
    stake := greatest(1, round(k * least(c_expected, o_expected)));
    transfer := stake + (case when coalesce(m.wager, 0) > 0 then m.wager else 0 end);
    if p_winner_id = m.challenger_id then
      transfer := least(transfer, greatest(0, o_rating - 100));  -- loser = opponent
      c_new := c_rating + transfer;
      o_new := o_rating - transfer;
    else
      transfer := least(transfer, greatest(0, c_rating - 100));  -- loser = challenger
      o_new := o_rating + transfer;
      c_new := c_rating - transfer;
    end if;
  end if;

  if is_casual then
    c_new := c_rating; o_new := o_rating;
  else
    update public.profiles
       set rating = c_new,
           wins   = wins   + (case when p_result <> 'draw' and p_winner_id = m.challenger_id then 1 else 0 end),
           losses = losses + (case when p_result <> 'draw' and p_winner_id = m.opponent_id  then 1 else 0 end),
           draws  = draws  + (case when p_result = 'draw' then 1 else 0 end)
     where id = m.challenger_id;
    update public.profiles
       set rating = o_new,
           wins   = wins   + (case when p_result <> 'draw' and p_winner_id = m.opponent_id  then 1 else 0 end),
           losses = losses + (case when p_result <> 'draw' and p_winner_id = m.challenger_id then 1 else 0 end),
           draws  = draws  + (case when p_result = 'draw' then 1 else 0 end)
     where id = m.opponent_id;
  end if;

  update public.matches
     set status = 'completed', winner_id = p_winner_id, result = p_result,
         method = p_method, notes = coalesce(p_notes, notes), result_proposed_by = null,
         sub_category = p_sub_category,
         challenger_rating_before = c_rating, opponent_rating_before = o_rating,
         challenger_rating_after = c_new, opponent_rating_after = o_new,
         completed_at = now()
   where id = p_match_id
   returning * into m;
  return m;
end; $$;

-- NO 5-arg overload. The 6-arg version defaults p_sub_category, so a 5-argument
-- call binds to it directly. Keeping a separate 5-arg function alongside the
-- defaulted 6-arg made EVERY 5-argument call ambiguous (Postgres 42725 "function
-- is not unique"), which silently broke the dual-report and admin dispute
-- settlement paths (match-disputes.sql calls with 5 args). Drop it for good.
drop function if exists public._settle_match(uuid, uuid, result_type, text, text);

-- Internal-only helper: never client-callable (its callers authorize first).
revoke execute on function public._settle_match(uuid, uuid, result_type, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
select 'ror-symmetric-stake (unified, transfer-floor) installed' as ok;
