import type { Ionicons } from '@expo/vector-icons';
import type { MatchWithPeople, Profile } from './types';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  earned: boolean;
}

interface Derived {
  total: number;
  wins: number;
  submissionWins: number;
  wageredWins: number;
  publicAppearances: number;
  giantSlayer: boolean;
  streak: number;
}

function derive(profile: Profile, matches: MatchWithPeople[], streak: number): Derived {
  let submissionWins = 0;
  let wageredWins = 0;
  let publicAppearances = 0;
  let giantSlayer = false;

  for (const m of matches) {
    if (m.status !== 'completed') continue;
    const iAmChallenger = m.challenger_id === profile.id;
    const iAmCompetitor = iAmChallenger || m.opponent_id === profile.id;
    if (!iAmCompetitor) continue;
    if (m.is_public) publicAppearances += 1;
    const iWon = m.winner_id === profile.id;
    if (!iWon) continue;
    if (m.result === 'submission') submissionWins += 1;
    if (m.wager > 0) wageredWins += 1;
    const myBefore = iAmChallenger ? m.challenger_rating_before : m.opponent_rating_before;
    const oppBefore = iAmChallenger ? m.opponent_rating_before : m.challenger_rating_before;
    if (myBefore != null && oppBefore != null && oppBefore - myBefore >= 150) giantSlayer = true;
  }

  return {
    total: profile.wins + profile.losses + profile.draws,
    wins: profile.wins,
    submissionWins,
    wageredWins,
    publicAppearances,
    giantSlayer,
    streak,
  };
}

export function computeAchievements(
  profile: Profile,
  matches: MatchWithPeople[],
  streak: number,
): Achievement[] {
  const d = derive(profile, matches, streak);
  const defs: (Omit<Achievement, 'earned'> & { test: (d: Derived) => boolean })[] = [
    { id: 'first_blood', name: 'First Blood', description: 'Win your first match', icon: 'water', test: (x) => x.wins >= 1 },
    { id: 'on_a_roll', name: 'On a Roll', description: 'Hit a 3-win streak', icon: 'flame', test: (x) => x.streak >= 3 },
    { id: 'finisher', name: 'Finisher', description: '10 wins by submission', icon: 'hand-left', test: (x) => x.submissionWins >= 10 },
    { id: 'giant_slayer', name: 'Giant Slayer', description: 'Beat someone 150+ rating above you', icon: 'trending-up', test: (x) => x.giantSlayer },
    { id: 'high_roller', name: 'High Roller', description: 'Win a wagered match', icon: 'cash', test: (x) => x.wageredWins >= 1 },
    { id: 'on_camera', name: 'On Camera', description: 'Compete in a public match', icon: 'videocam', test: (x) => x.publicAppearances >= 1 },
    { id: 'veteran', name: 'Veteran', description: 'Compete in 25 matches', icon: 'shield', test: (x) => x.total >= 25 },
    { id: 'iron_man', name: 'Iron Man', description: 'Compete in 50 matches', icon: 'barbell', test: (x) => x.total >= 50 },
  ];
  return defs.map(({ test, ...rest }) => ({ ...rest, earned: test(d) }));
}
