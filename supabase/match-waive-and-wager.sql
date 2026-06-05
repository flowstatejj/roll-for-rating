-- ============================================================================
-- Roll for Rating — Waive-referee (filmed + mutual confirmation) + wager band
-- Run after schema.sql, challenges.sql, videos.sql, minor-referee-rules.sql.
-- Safe to re-run.
--
-- Adds:
--  • Matches can be reffed (as before) OR waived: both competitors agree to skip
--    the referee. A waived match must be FILMED (a video attached) and its result
--    must be confirmed by BOTH competitors before any ROR / wager moves.
--  • Wagers are only allowed against an opponent within 10% of your ROR.
--  • Minors can never waive the referee (kid protections stay intact).
-- ============================================================================

-- new status: one competitor logged a result, waiting for the other to confirm
alter type match_status add value if not exists 'pending_confirmation';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.matches alter column referee_id drop not null;
alter table public.matches add column if not exists referee_waived      boolean not null default false;
alter table public.matches add column if not exists result_proposed_by  uuid references public.profiles (id);

-- referee (when present) still can't be a competitor; allow NULL when waived
alter table public.matches drop constraint if exists referee_not_competitor;
alter table public.matches add constraint referee_not_competitor
  check (referee_id is null or (referee_id <> challenger_id and referee_id <> opponent_id));

-- exactly one mode: a real referee, or a waiver (and then no referee)
alter table public.matches drop constraint if exists referee_mode;
alter table public.matches add constraint referee_mode
  check ((referee_waived and referee_id is null) or (not referee_waived and referee_id is not null));

-- ---------------------------------------------------------------------------
-- 2. _settle_match — the scoring engine (Elo + wager + complete). Shared by the
--    referee path and the waived-confirm path. Callers do their own auth first.
-- ---------------------------------------------------------------------------
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
  c_new integer; o_new integer;
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
  c_new := round(c_rating + k * (c_score - c_expected));
  o_new := round(o_rating + k * (o_score - o_expected));

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

-- ---------------------------------------------------------------------------
-- 3. record_match_result — referee scores directly; for a waived match a
--    competitor logs a PROPOSED result (a video must already be attached).
-- ---------------------------------------------------------------------------
create or replace function public.record_match_result(
  p_match_id uuid, p_winner_id uuid, p_result result_type,
  p_method text default null, p_notes text default null
)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches; n_videos integer;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'pending_referee' then raise exception 'Match is not ready to be scored'; end if;

  -- validate the result shape
  if p_result = 'draw' then
    if p_winner_id is not null then raise exception 'A draw has no winner'; end if;
  else
    if p_winner_id is null then raise exception 'A winner is required'; end if;
    if p_winner_id not in (m.challenger_id, m.opponent_id) then
      raise exception 'Winner must be one of the competitors';
    end if;
  end if;

  if m.referee_waived then
    -- no referee: a competitor proposes the result; the other must confirm
    if auth.uid() not in (m.challenger_id, m.opponent_id) then
      raise exception 'Only a competitor can record a waived match';
    end if;
    select count(*) into n_videos from public.match_videos where match_id = m.id;
    if n_videos = 0 then
      raise exception 'A video of the match is required to record it without a referee.';
    end if;
    update public.matches
       set status = 'pending_confirmation', winner_id = p_winner_id, result = p_result,
           method = p_method, notes = p_notes, result_proposed_by = auth.uid()
     where id = m.id
     returning * into m;
    return m;
  else
    if m.referee_id <> auth.uid() then raise exception 'Only the referee can record the result'; end if;
    return public._settle_match(m.id, p_winner_id, p_result, p_method, p_notes);
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. confirm_match_result — the OTHER competitor confirms or disputes a
--    proposed result on a waived match.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_match_result(p_match_id uuid, p_accept boolean)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'pending_confirmation' then raise exception 'No result is awaiting confirmation'; end if;
  if auth.uid() not in (m.challenger_id, m.opponent_id) then
    raise exception 'Only a competitor can confirm the result';
  end if;

  if p_accept then
    -- only the OTHER competitor can confirm (you can't confirm your own claim)
    if auth.uid() = m.result_proposed_by then
      raise exception 'You logged this result — the other competitor has to confirm it';
    end if;
    return public._settle_match(m.id, m.winner_id, m.result, m.method, m.notes);
  else
    -- dispute / withdraw: either competitor may reopen for re-recording.
    -- The attached video stays as evidence.
    update public.matches
       set status = 'pending_referee', winner_id = null, result = null,
           method = null, result_proposed_by = null
     where id = m.id
     returning * into m;
    return m;
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. Wager band — a wager is only allowed within 10% of the challenger's ROR.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_wager_band()
returns trigger language plpgsql security definer set search_path = public as $$
declare c_rating integer; o_rating integer;
begin
  if coalesce(new.wager, 0) > 0 then
    select rating into c_rating from public.profiles where id = new.challenger_id;
    select rating into o_rating from public.profiles where id = new.opponent_id;
    if c_rating is not null and o_rating is not null and abs(o_rating - c_rating) > 0.10 * c_rating then
      raise exception 'Wagers are only allowed against players within 10%% of your ROR.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_wager_band on public.matches;
create trigger trg_wager_band before insert on public.matches
  for each row execute function public.enforce_wager_band();

-- ---------------------------------------------------------------------------
-- 6. Waive safety — a match involving a minor can NEVER waive the referee.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_waive_safety()
returns trigger language plpgsql security definer set search_path = public as $$
declare c_minor boolean; o_minor boolean;
begin
  if new.referee_waived then
    select is_minor into c_minor from public.profiles where id = new.challenger_id;
    select is_minor into o_minor from public.profiles where id = new.opponent_id;
    if coalesce(c_minor, false) or coalesce(o_minor, false) then
      raise exception 'Matches involving a minor require a neutral referee and cannot waive it.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_waive_safety on public.matches;
create trigger trg_waive_safety before insert on public.matches
  for each row execute function public.enforce_waive_safety();
