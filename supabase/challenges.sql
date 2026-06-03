-- ============================================================================
-- Rollr — "Open for a challenge" + Elo wagers
-- Run this in the Supabase SQL Editor (after schema.sql + social.sql). Re-runnable.
-- ============================================================================

-- Profile availability + area
alter table public.profiles add column if not exists open_for_challenge boolean not null default false;
alter table public.profiles add column if not exists city text;
create index if not exists profiles_open_idx on public.profiles (open_for_challenge) where open_for_challenge;

-- Let members toggle availability / set their city directly.
revoke update on public.profiles from authenticated;
grant update (display_name, belt_rank, gym_id, open_for_challenge, city) on public.profiles to authenticated;

-- Wager (extra Elo staked on the match)
alter table public.matches add column if not exists wager integer not null default 0;

-- ---------------------------------------------------------------------------
-- record_match_result — Elo + draw-as-loss + WAGER transfer (ratings floor 100)
-- ---------------------------------------------------------------------------
create or replace function public.record_match_result(
  p_match_id uuid,
  p_winner_id uuid,
  p_result result_type,
  p_method text default null,
  p_notes  text default null
)
returns public.matches
language plpgsql
security definer set search_path = public
as $$
declare
  m          public.matches;
  k          constant integer := 32;
  c_rating   integer;
  o_rating   integer;
  c_score    double precision;
  o_score    double precision;
  c_expected double precision;
  o_expected double precision;
  c_new      integer;
  o_new      integer;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.referee_id <> auth.uid() then raise exception 'Only the referee can record the result'; end if;
  if m.status <> 'pending_referee' then raise exception 'Match is not ready to be scored'; end if;

  if p_result = 'draw' then
    if p_winner_id is not null then raise exception 'A draw has no winner'; end if;
  else
    if p_winner_id is null then raise exception 'A winner is required'; end if;
    if p_winner_id not in (m.challenger_id, m.opponent_id) then
      raise exception 'Winner must be one of the competitors';
    end if;
  end if;

  select rating into c_rating from public.profiles where id = m.challenger_id for update;
  select rating into o_rating from public.profiles where id = m.opponent_id for update;

  -- Draw is penalised like a loss for both.
  if p_result = 'draw' then
    c_score := 0.0; o_score := 0.0;
  elsif p_winner_id = m.challenger_id then
    c_score := 1.0; o_score := 0.0;
  else
    c_score := 0.0; o_score := 1.0;
  end if;

  c_expected := public.elo_expected(c_rating, o_rating);
  o_expected := public.elo_expected(o_rating, c_rating);
  c_new := round(c_rating + k * (c_score - c_expected));
  o_new := round(o_rating + k * (o_score - o_expected));

  -- Wager: on a decisive result the winner takes the staked Elo from the loser.
  if p_result <> 'draw' and coalesce(m.wager, 0) > 0 then
    if p_winner_id = m.challenger_id then
      c_new := c_new + m.wager; o_new := o_new - m.wager;
    else
      o_new := o_new + m.wager; c_new := c_new - m.wager;
    end if;
  end if;

  c_new := greatest(100, c_new);  -- rating floor
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
     set status = 'completed',
         winner_id = p_winner_id,
         result = p_result,
         method = p_method,
         notes = p_notes,
         challenger_rating_before = c_rating,
         opponent_rating_before   = o_rating,
         challenger_rating_after  = c_new,
         opponent_rating_after    = o_new,
         completed_at = now()
   where id = p_match_id
   returning * into m;

  return m;
end;
$$;
