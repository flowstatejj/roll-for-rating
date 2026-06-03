-- ============================================================================
-- Rollr — Written-puzzle grading (used by the grade-puzzle function)
-- Run this in the Supabase SQL Editor (after puzzles.sql). Safe to re-run.
-- ============================================================================

-- Applies an AI grade to a written puzzle. Called only by the edge function
-- (service role) with a verified user id — execute is revoked from clients so
-- nobody can submit a fake grade.
create or replace function public.submit_puzzle_written(
  p_puzzle_id uuid,
  p_user_id   uuid,
  p_answer    text,
  p_is_correct boolean,
  p_score     integer,
  p_feedback  text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  pz         public.puzzles;
  k          constant integer := 12;
  u_rating   integer;
  already    boolean;
  expected   double precision;
  score_frac double precision;
  r_before   integer;
  r_after    integer;
  did_rate   boolean := false;
begin
  select * into pz from public.puzzles where id = p_puzzle_id;
  if not found then raise exception 'Puzzle not found'; end if;

  select exists(
    select 1 from public.puzzle_attempts
    where puzzle_id = p_puzzle_id and user_id = p_user_id and rated
  ) into already;

  select rating into u_rating from public.profiles where id = p_user_id for update;
  r_before := u_rating;
  r_after := u_rating;
  score_frac := greatest(0, least(1, coalesce(p_score, 0)::double precision / 100));

  if not already then
    expected := public.elo_expected(u_rating, pz.rating);
    r_after := round(u_rating + k * (score_frac - expected));  -- partial credit moves rating proportionally
    update public.profiles set rating = r_after where id = p_user_id;
    did_rate := true;
  end if;

  insert into public.puzzle_attempts
    (puzzle_id, user_id, given_answer, is_correct, score, feedback, rating_before, rating_after, rated)
  values
    (p_puzzle_id, p_user_id, p_answer, coalesce(p_is_correct, false), p_score, p_feedback, r_before, r_after, did_rate);

  return jsonb_build_object(
    'is_correct', coalesce(p_is_correct, false),
    'score', p_score,
    'feedback', p_feedback,
    'explanation', pz.explanation,
    'rating_before', r_before,
    'rating_after', r_after,
    'delta', r_after - r_before,
    'rated', did_rate
  );
end;
$$;

revoke execute on function public.submit_puzzle_written(uuid, uuid, text, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.submit_puzzle_written(uuid, uuid, text, boolean, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Seed a couple of written puzzles (the rubric stays hidden from clients)
-- ---------------------------------------------------------------------------
insert into public.puzzles (kind, title, image_url, question, rubric, explanation, rating)
values
  ('written', 'Escaping side control',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Side+Control',
   'Your opponent has strong side control on you. Describe your first priorities and one escape you would attempt.',
   'A strong answer covers: (1) framing to make space and protect the neck / stop the cross-face, (2) getting onto your side and recovering hip mobility, (3) a concrete escape — e.g. shrimp to recover guard, ghost/granby roll, or underhook to come up. Award partial credit for any of these.',
   'Frame and protect, get to your side, then shrimp to recover guard or underhook to come up.',
   1200),
  ('written', 'Principles of guard passing',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Guard+Pass',
   'What general principles make a guard pass effective? Name at least two and explain briefly.',
   'Strong answers name principles such as: controlling the hips/legs, heavy connected forward pressure (weight down), staying based / off the heels, controlling inside space, head position, and denying the opponent frames and angle. Two well-explained principles is a good answer.',
   'Effective passing centers on hip/leg control, heavy connected pressure, base, and denying space and frames.',
   1300)
on conflict do nothing;
