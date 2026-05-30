// Client-side mirror of the server Elo math (schema.sql / challenges.sql) so the
// app can preview swings before a match. Keep K / FLOOR in sync with the DB.
const K = 32;
const FLOOR = 100;

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/**
 * Projected rating change for `rating` vs `opponent` on a win or a loss,
 * including the wager transfer and the rating floor.
 */
export function projectSwing(rating: number, opponent: number, wager = 0): { win: number; loss: number } {
  const e = expectedScore(rating, opponent);
  const winRaw = rating + Math.round(K * (1 - e)) + wager;
  const lossRaw = rating + Math.round(K * (0 - e)) - wager;
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
