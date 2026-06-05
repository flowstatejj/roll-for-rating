-- ============================================================================
-- Roll for Rating — Mismatch damping on ROR changes
-- Run after match-waive-and-wager.sql. Safe to re-run.
--
-- The bigger the rating gap between the two competitors, the less ROR is risked
-- OR gained — so a strong player can't stack rating by farming much weaker
-- opponents (and also doesn't risk much against them). The wager transfer is
-- unchanged (wagers are already limited to opponents within 10% of your ROR).
--
-- Factor: 1.0 for an even match, falling linearly to 0 across a 500-point gap.
--   factor = greatest(0, 1 - gap / 500)
--   gap 0 -> 1.00   gap 100 -> 0.80   gap 250 -> 0.50   gap 500+ -> 0
-- A DECISIVE result still always moves each player's ROR by at least 1 point
-- (a win is worth >= +1, a loss costs <= -1), so a match always counts.
-- ============================================================================

create or replace function public._settle_match(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_method text, p_notes text
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
  mismatch double precision;
begin
  select * into m from public.matches where id = p_match_id for update;

  select rating into c_rating from public.profiles where id = m.challenger_id for update;
  select rating into o_rating from public.profiles where id = m.opponent_id  for update;

  if p_result = 'draw' then
    c_score := 0.0; o_score := 0.0;            -- draw penalised like a loss for both
  elsif p_winner_id = m.challenger_id then
    c_score := 1.0; o_score := 0.0;
  else
    c_score := 0.0; o_score := 1.0;
  end if;

  c_expected := public.elo_expected(c_rating, o_rating);
  o_expected := public.elo_expected(o_rating, c_rating);

  -- Damp the ROR swing by the rating gap (symmetric for both players).
  mismatch := greatest(0.0, 1 - abs(c_rating - o_rating) / 500.0);

  c_delta := round(k * (c_score - c_expected) * mismatch);
  o_delta := round(k * (o_score - o_expected) * mismatch);

  -- A decisive result always moves each player at least 1 point.
  if p_result <> 'draw' then
    if p_winner_id = m.challenger_id then
      c_delta := greatest(1, c_delta); o_delta := least(-1, o_delta);
    else
      o_delta := greatest(1, o_delta); c_delta := least(-1, c_delta);
    end if;
  end if;

  c_new := c_rating + c_delta;
  o_new := o_rating + o_delta;

  -- Wager: a flat, agreed transfer (only possible within a 10% band), not damped.
  if p_result <> 'draw' and coalesce(m.wager, 0) > 0 then
    if p_winner_id = m.challenger_id then
      c_new := c_new + m.wager; o_new := o_new - m.wager;
    else
      o_new := o_new + m.wager; c_new := c_new - m.wager;
    end if;
  end if;

  c_new := greatest(100, c_new);
  o_new := greatest(100, o_new);

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

  update public.matches
     set status = 'completed', winner_id = p_winner_id, result = p_result,
         method = p_method, notes = coalesce(p_notes, notes), result_proposed_by = null,
         challenger_rating_before = c_rating, opponent_rating_before = o_rating,
         challenger_rating_after = c_new, opponent_rating_after = o_new,
         completed_at = now()
   where id = p_match_id
   returning * into m;
  return m;
end; $$;
