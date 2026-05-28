// Hand-written types that mirror supabase/schema.sql.
// Keep these in sync with the schema (or later generate them with the Supabase CLI).

export type BeltRank = 'white' | 'blue' | 'purple' | 'brown' | 'black';

export type MatchStatus =
  | 'pending_opponent'
  | 'pending_referee'
  | 'completed'
  | 'declined'
  | 'cancelled';

export type ResultType = 'submission' | 'points' | 'advantage' | 'decision' | 'draw';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  belt_rank: BeltRank;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
}

export interface Match {
  id: string;
  challenger_id: string;
  opponent_id: string;
  referee_id: string;
  status: MatchStatus;
  winner_id: string | null;
  result: ResultType | null;
  method: string | null;
  notes: string | null;
  challenger_rating_before: number | null;
  opponent_rating_before: number | null;
  challenger_rating_after: number | null;
  opponent_rating_after: number | null;
  created_at: string;
  completed_at: string | null;
}

// A match row joined with the three people's profiles (used in lists / detail).
export interface MatchWithPeople extends Match {
  challenger: Pick<Profile, 'id' | 'username' | 'display_name' | 'belt_rank' | 'rating'>;
  opponent: Pick<Profile, 'id' | 'username' | 'display_name' | 'belt_rank' | 'rating'>;
  referee: Pick<Profile, 'id' | 'username' | 'display_name' | 'belt_rank' | 'rating'>;
}

export const BELT_LABELS: Record<BeltRank, string> = {
  white: 'White',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown',
  black: 'Black',
};

export const BELT_COLORS: Record<BeltRank, string> = {
  white: '#D6D6DB',
  blue: '#2E6BE6',
  purple: '#8B5CF6',
  brown: '#7C4A1E',
  black: '#111111',
};

export const RESULT_LABELS: Record<ResultType, string> = {
  submission: 'Submission',
  points: 'Points',
  advantage: 'Advantage',
  decision: "Referee's decision",
  draw: 'Draw',
};
