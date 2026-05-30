import type { MatchWithPeople } from './types';

export interface Rivalry {
  opponentId: string;
  name: string;
  belt: MatchWithPeople['challenger']['belt_rank'];
  rating: number;
  wins: number; // your wins vs them
  losses: number;
  draws: number;
  total: number;
}

/** Build your head-to-head record against every opponent you've completed a match with. */
export function computeRivalries(matches: MatchWithPeople[], userId: string): Rivalry[] {
  const byOpp = new Map<string, Rivalry>();

  for (const m of matches) {
    if (m.status !== 'completed') continue;
    const iAmChallenger = m.challenger_id === userId;
    const iAmCompetitor = iAmChallenger || m.opponent_id === userId;
    if (!iAmCompetitor) continue;

    const other = iAmChallenger ? m.opponent : m.challenger;
    let r = byOpp.get(other.id);
    if (!r) {
      r = { opponentId: other.id, name: other.display_name, belt: other.belt_rank, rating: other.rating, wins: 0, losses: 0, draws: 0, total: 0 };
      byOpp.set(other.id, r);
    }
    r.total += 1;
    if (m.result === 'draw') r.draws += 1;
    else if (m.winner_id === userId) r.wins += 1;
    else r.losses += 1;
  }

  return [...byOpp.values()].sort((a, b) => b.total - a.total);
}
