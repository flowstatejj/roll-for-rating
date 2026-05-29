import { supabase } from './supabase';
import type { Puzzle, PuzzleKind, PuzzleResult, PuzzleStats } from './types';

// Columns clients are allowed to read (answer columns are blocked server-side).
const PUZZLE_COLS = 'id,kind,title,image_url,question,choices,rating,created_at';

/**
 * Pick a puzzle of the given kind for the user — preferring ones they haven't
 * answered yet (those are the rated ones), falling back to any for practice.
 */
export async function fetchNextPuzzle(userId: string, kind: PuzzleKind): Promise<Puzzle | null> {
  const [{ data: puzzles, error: pErr }, { data: attempts, error: aErr }] = await Promise.all([
    supabase.from('puzzles').select(PUZZLE_COLS).eq('kind', kind).limit(100),
    supabase.from('puzzle_attempts').select('puzzle_id').eq('user_id', userId).eq('rated', true),
  ]);
  if (pErr) throw pErr;
  if (aErr) throw aErr;

  const all = (puzzles ?? []) as unknown as Puzzle[];
  if (all.length === 0) return null;

  const done = new Set((attempts ?? []).map((a: { puzzle_id: string }) => a.puzzle_id));
  const fresh = all.filter((p) => !done.has(p.id));
  const pool = fresh.length > 0 ? fresh : all; // practice mode once all are done
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Submit a multiple-choice answer; grading + rating happen server-side. */
export async function submitMc(puzzleId: string, choice: number): Promise<PuzzleResult> {
  const { data, error } = await supabase.rpc('submit_puzzle_mc', {
    p_puzzle_id: puzzleId,
    p_choice: choice,
  });
  if (error) throw error;
  return data as PuzzleResult;
}

/**
 * Submit a written answer for AI grading (Phase 2 — needs the `grade-puzzle`
 * edge function deployed). Throws a friendly error until then.
 */
export async function submitWritten(puzzleId: string, answer: string): Promise<PuzzleResult> {
  const { data, error } = await supabase.functions.invoke('grade-puzzle', {
    body: { puzzle_id: puzzleId, answer },
  });
  if (error) throw new Error('AI grading isn’t set up yet. Deploy the grade-puzzle function first.');
  return data as PuzzleResult;
}

/** Aggregate the user's puzzle performance. */
export async function fetchPuzzleStats(userId: string): Promise<PuzzleStats> {
  const { data, error } = await supabase
    .from('puzzle_attempts')
    .select('puzzle_id,is_correct')
    .eq('user_id', userId);
  if (error) throw error;

  const rows = data ?? [];
  const attempts = rows.length;
  const correct = rows.filter((r: { is_correct: boolean }) => r.is_correct).length;
  const solved = new Set(
    rows.filter((r: { is_correct: boolean }) => r.is_correct).map((r: { puzzle_id: string }) => r.puzzle_id),
  ).size;
  const accuracy = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
  return { attempts, correct, solved, accuracy };
}
