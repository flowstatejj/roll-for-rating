// Client-side mirror of the server Elo math (schema.sql / challenges.sql /
// match-waive-and-wager.sql) so the app can preview swings before a match.
// Keep K / FLOOR / MISMATCH_* in sync with the DB (_settle_match).
const K = 32;
const FLOOR = 100;
// Mismatch damping: the bigger the rating gap, the less ROR is risked or gained,
// so strong players can't farm rating off much weaker ones. Tunable.
const MISMATCH_SCALE = 1000; // gap (in points) over which the factor falls to 0
const MIN_DECISIVE = 1; // a decisive result always moves ROR by at least this many points

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** 1.0 for an even match, tapering linearly to 0 as the rating gap reaches MISMATCH_SCALE. */
export function mismatchFactor(rating: number, opponent: number): number {
  return Math.max(0, 1 - Math.abs(rating - opponent) / MISMATCH_SCALE);
}

/**
 * Projected rating change for `rating` vs `opponent` on a win or a loss,
 * including the mismatch damping, a ±1 floor on decisive results, the wager
 * transfer, and the rating floor.
 */
export function projectSwing(rating: number, opponent: number, wager = 0): { win: number; loss: number } {
  const e = expectedScore(rating, opponent);
  const m = mismatchFactor(rating, opponent);
  const winDelta = Math.max(MIN_DECISIVE, Math.round(K * (1 - e) * m));
  const lossDelta = Math.min(-MIN_DECISIVE, Math.round(K * (0 - e) * m));
  const winRaw = rating + winDelta + wager;
  const lossRaw = rating + lossDelta - wager;
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
