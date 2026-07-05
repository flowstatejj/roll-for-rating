// Client-side mirror of the server settlement math (supabase _settle_match,
// unified on the symmetric smaller-swing stake) so the app can preview swings
// before a match. Keep K / FLOOR / MIN_DECISIVE and the stake formula in sync
// with the DB _settle_match (the decisive branch).
const K = 32;
const FLOOR = 100;
const MIN_DECISIVE = 1; // a decisive result always moves ROR by at least this many points

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/**
 * Symmetric decisive stake: K * E(underdog). Both players risk/earn only the
 * SMALLER swing, so the higher-rated player never gains or loses more than the
 * lower-rated opponent. min(e, 1 - e) is the underdog's expected score.
 *   even match -> 16, 400 gap -> ~3, 1000+ gap -> 1 (floor).
 */
export function decisiveStake(rating: number, opponent: number): number {
  const e = expectedScore(rating, opponent);
  return Math.max(MIN_DECISIVE, Math.round(K * Math.min(e, 1 - e)));
}

/**
 * Projected rating change for `rating` vs `opponent` on a win or a loss. The
 * match is a SINGLE transfer T = stake + wager (winner +T, loser -T), clamped to
 * what the loser can actually pay down to the 100 floor -- so neither side ever
 * moves more than the other, even at the floor. On a win the loser is `opponent`;
 * on a loss the loser is us. Mirrors the server _settle_match decisive branch.
 */
export function projectSwing(rating: number, opponent: number, wager = 0): { win: number; loss: number } {
  const t = decisiveStake(rating, opponent) + wager;
  return {
    win: Math.min(t, Math.max(0, opponent - FLOOR)),
    loss: -Math.min(t, Math.max(0, rating - FLOOR)),
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
