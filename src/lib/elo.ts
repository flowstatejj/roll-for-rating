// Client-side mirror of the server Elo math (schema.sql / challenges.sql /
// match-waive-and-wager.sql) so the app can preview swings before a match.
// Keep K / FLOOR / MISMATCH_* in sync with the DB (_settle_match).
const K = 32;
const FLOOR = 100;
// Mismatch damping: the bigger the rating gap, the less ROR is risked or gained,
// so strong players can't farm rating off much weaker ones. Tunable.
const MISMATCH_SCALE = 500; // gap (in points) over which the factor falls to the floor
const MISMATCH_FLOOR = 0.1; // a huge mismatch is still worth at least 10% of normal

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** 1.0 for an even match, tapering to MISMATCH_FLOOR as the rating gap grows. */
export function mismatchFactor(rating: number, opponent: number): number {
  return Math.max(MISMATCH_FLOOR, 1 - Math.abs(rating - opponent) / MISMATCH_SCALE);
}

/**
 * Projected rating change for `rating` vs `opponent` on a win or a loss,
 * including the mismatch damping, the wager transfer, and the rating floor.
 */
export function projectSwing(rating: number, opponent: number, wager = 0): { win: number; loss: number } {
  const e = expectedScore(rating, opponent);
  const m = mismatchFactor(rating, opponent);
  const winRaw = rating + Math.round(K * (1 - e) * m) + wager;
  const lossRaw = rating + Math.round(K * (0 - e) * m) - wager;
  return {
    win: Math.max(FLOOR, winRaw) - rating,
    loss: Math.max(FLOOR, lossRaw) - rating,
  };
}

/** Current consecutive-win streak from the user's completed matches (any order in). */
export function winStreak(
  matches: { status: string; winner_id: string | null; completed_at: string | null; challenger_id: string; opponent_id: string }[],
  userId: string,
): number {
  const mine = matches
    .filter(
      (m) =>
        m.status === 'completed' &&
        m.completed_at &&
        (m.challenger_id === userId || m.opponent_id === userId),
    )
    .sort((a, b) => (b.completed_at! < a.completed_at! ? -1 : 1));
  let streak = 0;
  for (const m of mine) {
    if (m.winner_id === userId) streak += 1;
    else break;
  }
  return streak;
}
