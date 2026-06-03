-- ============================================================================
-- Roll for Rating — Puzzles feature
-- Run this in the Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================================

do $$ begin
  create type puzzle_kind as enum ('multiple_choice', 'written');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- puzzles — a question about a position, with the answer kept server-side
-- ---------------------------------------------------------------------------
create table if not exists public.puzzles (
  id            uuid primary key default gen_random_uuid(),
  kind          puzzle_kind not null,
  title         text,
  image_url     text,
  question      text not null,
  choices       jsonb,            -- multiple_choice: ["A","B","C","D"]
  correct_index integer,          -- multiple_choice: index into choices (HIDDEN from clients)
  rubric        text,             -- written: what a good answer should include (HIDDEN)
  explanation   text,             -- shown AFTER answering (HIDDEN until then)
  rating        integer not null default 1200,  -- puzzle difficulty
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- puzzle_attempts — one row per answer; only the FIRST attempt is rated
-- ---------------------------------------------------------------------------
create table if not exists public.puzzle_attempts (
  id            uuid primary key default gen_random_uuid(),
  puzzle_id     uuid not null references public.puzzles (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  given_answer  text,
  is_correct    boolean not null,
  score         integer,          -- 0..100
  feedback      text,             -- AI feedback (written puzzles)
  rating_before integer,
  rating_after  integer,
  rated         boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists puzzle_attempts_user_idx on public.puzzle_attempts (user_id);
create index if not exists puzzle_attempts_puzzle_idx on public.puzzle_attempts (puzzle_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.puzzles enable row level security;
alter table public.puzzle_attempts enable row level security;

-- Everyone signed in can read puzzles — but NOT the answer columns.
-- Column privileges below stop clients from selecting correct_index/rubric/explanation.
drop policy if exists "puzzles_read_all" on public.puzzles;
create policy "puzzles_read_all" on public.puzzles for select to authenticated using (true);

revoke select on public.puzzles from authenticated;
grant select (id, kind, title, image_url, question, choices, rating, created_at)
  on public.puzzles to authenticated;

-- Users may read only their own attempts. Inserts happen via the functions below.
drop policy if exists "attempts_read_own" on public.puzzle_attempts;
create policy "attempts_read_own" on public.puzzle_attempts
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- submit_puzzle_mc — grade a multiple-choice answer + nudge the main rating
-- (server-side: the correct answer never leaves the database)
-- ---------------------------------------------------------------------------
create or replace function public.submit_puzzle_mc(p_puzzle_id uuid, p_choice integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  pz        public.puzzles;
  k         constant integer := 12;   -- gentler than match K (32) so puzzles don't swing the ladder
  u_rating  integer;
  already   boolean;
  correct   boolean;
  expected  double precision;
  r_before  integer;
  r_after   integer;
  did_rate  boolean := false;
begin
  select * into pz from public.puzzles where id = p_puzzle_id;
  if not found then raise exception 'Puzzle not found'; end if;
  if pz.kind <> 'multiple_choice' then raise exception 'Not a multiple-choice puzzle'; end if;

  correct := (p_choice = pz.correct_index);

  -- Only the first rated attempt at a given puzzle affects rating.
  select exists(
    select 1 from public.puzzle_attempts
    where puzzle_id = p_puzzle_id and user_id = auth.uid() and rated
  ) into already;

  select rating into u_rating from public.profiles where id = auth.uid() for update;
  r_before := u_rating;
  r_after := u_rating;

  if not already then
    expected := public.elo_expected(u_rating, pz.rating);
    r_after := round(u_rating + k * ((case when correct then 1 else 0 end) - expected));
    update public.profiles set rating = r_after where id = auth.uid();
    did_rate := true;
  end if;

  insert into public.puzzle_attempts
    (puzzle_id, user_id, given_answer, is_correct, score, rating_before, rating_after, rated)
  values
    (p_puzzle_id, auth.uid(), p_choice::text, correct, case when correct then 100 else 0 end, r_before, r_after, did_rate);

  return jsonb_build_object(
    'is_correct', correct,
    'correct_index', pz.correct_index,
    'explanation', pz.explanation,
    'rating_before', r_before,
    'rating_after', r_after,
    'delta', r_after - r_before,
    'rated', did_rate
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed puzzles (multiple choice) — placeholder images for now
-- ---------------------------------------------------------------------------
insert into public.puzzles (kind, title, image_url, question, choices, correct_index, explanation, rating)
values
  ('multiple_choice', 'Closed guard basics',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Closed+Guard',
   'You are inside your opponent''s closed guard (they have their legs locked around you). What is your FIRST priority?',
   '["Posture up and control their hips","Drop your head to their chest","Dive for a submission","Stand and jump back"]'::jsonb,
   0, 'Posture and hip control come first — staying broken-down in closed guard lets them attack. Establish base, then work to open the guard.', 1100),

  ('multiple_choice', 'Escaping the mount',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Mount+Escape',
   'Your opponent has mounted you. Which classic escape uses a hip bridge to off-balance them?',
   '["Elbow escape (shrimp)","Upa / bridge-and-roll","Guard pull","Berimbolo"]'::jsonb,
   1, 'The Upa (bridge-and-roll) traps an arm and leg, then bridges over that side to reverse the mount. The shrimp is an elbow escape, not a bridge.', 1200),

  ('multiple_choice', 'Joint targets',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Submission',
   'Which of these submissions attacks the ELBOW joint?',
   '["Armbar","Triangle choke","Rear naked choke","Kimura"]'::jsonb,
   0, 'The armbar hyperextends the elbow. The triangle and RNC are chokes; the kimura attacks the shoulder.', 1000),

  ('multiple_choice', 'Position before submission',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Side+Control',
   'You have side control. Which transition generally gives you MORE control and points?',
   '["Knee-on-belly or mount","Back to closed guard","Give up to turtle","Half guard bottom"]'::jsonb,
   0, '"Position before submission" — advancing to knee-on-belly or mount improves control and scores points. The others are neutral or losing position.', 1150),

  ('multiple_choice', 'How chokes work',
   'https://placehold.co/800x480/312e2b/9bb4d4?text=Rear+Naked+Choke',
   'A properly applied rear naked choke works primarily by...',
   '["Compressing the carotid arteries (blood)","Crushing the windpipe only","Twisting the spine","Hyperextending the shoulder"]'::jsonb,
   0, 'A textbook RNC is a blood choke — it compresses the carotid arteries on both sides of the neck, not the airway.', 1050)
on conflict do nothing;
