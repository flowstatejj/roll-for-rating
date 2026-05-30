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
  gym_id: string | null;
  open_for_challenge: boolean;
  city: string | null;
  activity_streak: number;
  last_active_date: string | null;
  created_at: string;
}

export interface Quest {
  key: string;
  title: string;
  progress: number;
  target: number;
  reward: number;
  claimed: boolean;
}

export interface Season {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
}

export interface SeasonStanding {
  user_id: string;
  points: number;
  wins: number;
  profile: { id: string; display_name: string; belt_rank: BeltRank; rating: number } | null;
}

export interface GymPower {
  gym_id: string;
  name: string;
  city: string | null;
  member_count: number;
  avg_rating: number;
  total_wins: number;
}

export interface Tournament {
  id: string;
  name: string;
  host_id: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

export interface TournamentStanding {
  user_id: string;
  display_name: string;
  belt_rank: BeltRank;
  rating: number;
  wins: number;
}

// ---------------------------------------------------------------------------
// Community: gyms, gym friendships, open mats
// ---------------------------------------------------------------------------
export interface Gym {
  id: string;
  name: string;
  city: string | null;
  description: string | null;
  owner_id: string;
  created_at: string;
}

export interface GymWithMeta extends Gym {
  member_count: number;
  is_owner: boolean;
  is_member: boolean;
}

export interface GymFriend {
  friendship_id: string;
  gym: Gym;
  status: 'pending' | 'accepted';
  /** true when the OTHER gym sent it and we (our owned gym) can accept */
  incoming: boolean;
}

export interface OpenMat {
  id: string;
  title: string;
  gym_id: string | null;
  city: string | null;
  address: string | null;
  schedule: string | null;
  notes: string | null;
  created_by: string;
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
  wager: number;
  is_public: boolean;
  meet_when: string | null;
  meet_where: string | null;
  challenger_rating_before: number | null;
  opponent_rating_before: number | null;
  challenger_rating_after: number | null;
  opponent_rating_after: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface MatchMessage {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { display_name: string } | null;
}

// Huntable submission types for the Submission Hunt.
export const SUBMISSIONS = [
  'Rear naked choke',
  'Armbar',
  'Triangle',
  'Kimura',
  'Guillotine',
  'Americana',
  'Omoplata',
  'Heel hook',
  'Ezekiel',
  'Bow and arrow',
] as const;

// Emoji reactions members can leave on a public match (no comments).
export const REACTIONS = ['🔥', '👏', '💪', '🥋', '😮'] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ReactionSummary {
  counts: Record<string, number>;
  mine: string | null;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  match_id: string | null;
  read: boolean;
  created_at: string;
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

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------
export type PuzzleKind = 'multiple_choice' | 'written';

// Note: correct_index / rubric / explanation are intentionally NOT here —
// the database hides them from clients so answers can't be peeked.
export interface Puzzle {
  id: string;
  kind: PuzzleKind;
  title: string | null;
  image_url: string | null;
  question: string;
  choices: string[] | null;
  rating: number;
  created_at: string;
}

// Returned by the grading functions/edge function after an answer is submitted.
export interface PuzzleResult {
  is_correct: boolean;
  correct_index?: number; // multiple choice
  score?: number; // 0..100 (written)
  feedback?: string; // AI feedback (written)
  explanation: string | null;
  rating_before: number;
  rating_after: number;
  delta: number;
  rated: boolean;
}

export interface PuzzleStats {
  attempts: number;
  correct: number;
  solved: number; // distinct puzzles answered correctly
  accuracy: number; // 0..100
}

// ---------------------------------------------------------------------------
// Competition records (external W/L import)
// ---------------------------------------------------------------------------
export type CompSource = 'smoothcomp' | 'ibjjf' | 'adcc' | 'other';

export const COMP_SOURCE_LABELS: Record<CompSource, string> = {
  smoothcomp: 'Smoothcomp',
  ibjjf: 'IBJJF',
  adcc: 'ADCC',
  other: 'Other',
};

export interface CompetitionRecord {
  id: string;
  user_id: string;
  source: CompSource;
  profile_url: string | null;
  wins: number;
  losses: number;
  verified: boolean;
  rating_delta: number;
  created_at: string;
}

export interface CompetitionImportResult {
  source: CompSource;
  wins: number;
  losses: number;
  rating_delta: number;
  new_rating: number;
}

// ---------------------------------------------------------------------------
// Match videos
// ---------------------------------------------------------------------------
export interface MatchVideo {
  id: string;
  match_id: string;
  uploader_id: string;
  path: string;
  created_at: string;
}
