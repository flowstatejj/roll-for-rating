// Hand-written types that mirror supabase/schema.sql.
// Keep these in sync with the schema (or later generate them with the Supabase CLI).

export type BeltRank = 'white' | 'blue' | 'purple' | 'brown' | 'black';

/** Age tier, computed server-side from the member's birthdate. */
export type AgeTier = 'adult' | 'teen' | 'kid';
/** Parental-consent state for minor accounts. */
export type ConsentStatus = 'not_required' | 'pending' | 'verified';

export type MatchStatus =
  | 'pending_opponent'
  | 'pending_referee'
  | 'pending_confirmation'
  | 'completed'
  | 'declined'
  | 'cancelled';

export type ResultType = 'submission' | 'points' | 'advantage' | 'decision' | 'draw';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  belt_rank: BeltRank;
  /** path in the private 'avatars' bucket; view via a signed URL (lib/avatars). */
  avatar_path: string | null;
  /** historical-warrior emblem (non-photo identity; the only option for minors). */
  avatar_warrior: string | null;
  avatar_color: string | null;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  gym_id: string | null;
  open_for_challenge: boolean;
  city: string | null;
  activity_streak: number;
  last_active_date: string | null;
  is_minor: boolean;
  birthdate: string | null;
  age_tier: AgeTier;
  consent_status: ConsentStatus;
  /** For a parent-managed junior: the guardian's profile id. Null otherwise. */
  managed_by: string | null;
  /** Optional social handles/URLs (adults only). Build links via lib/socials. */
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  facebook: string | null;
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

export type LeagueAudience = 'all' | 'kids' | 'adults';
export type LeagueVisibility = 'open' | 'private';

export interface League {
  id: string;
  created_by: string;
  name: string;
  description: string | null;
  audience: LeagueAudience;
  ranked: boolean;
  visibility: LeagueVisibility;
  join_code: string;
  meet_day: number; // 0=Sun .. 6=Sat
  meet_time: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gym_id: string | null;
  season_starts: string; // date
  weeks: number;
  win_points: number;
  draw_points: number;
  loss_points: number;
  sub_kill_bonus: number;
  sub_break_bonus: number;
  created_at: string;
  /** present on rows fetched with membership context */
  member_count?: number;
  is_member?: boolean;
  is_organizer?: boolean;
}

export interface LeagueMember {
  league_id: string;
  user_id: string;
  role: 'organizer' | 'member';
  joined_week: number;
  active: boolean;
  joined_at: string;
  profile: { id: string; display_name: string; belt_rank: BeltRank; rating: number; avatar_path: string | null } | null;
}

export interface LeagueFixture {
  id: string;
  league_id: string;
  week_no: number;
  player_a: string;
  player_b: string | null; // null = bye
  match_id: string | null;
  a: { id: string; display_name: string; belt_rank: BeltRank } | null;
  b: { id: string; display_name: string; belt_rank: BeltRank } | null;
}

export interface LeagueStanding {
  user_id: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  profile?: { id: string; display_name: string; belt_rank: BeltRank; rating: number } | null;
}

export interface GymPower {
  gym_id: string;
  name: string;
  city: string | null;
  member_count: number;
  avg_rating: number;
  total_wins: number;
}

export type TournamentFormat = 'round_robin' | 'single_elim' | 'double_elim' | 'rr_playoff';
export type TournamentTeamRule = 'none' | 'duel' | 'quintet';
export type TournamentTeamBuild = 'host' | 'captain' | 'auto';

export interface Tournament {
  id: string;
  name: string;
  host_id: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  description: string | null;
  format: TournamentFormat;
  team_size: number; // 1 | 3 | 5
  team_rule: TournamentTeamRule;
  team_build: TournamentTeamBuild;
  ranked: boolean;
  win_points: number;
  draw_points: number;
  loss_points: number;
  sub_kill_bonus: number;
  sub_break_bonus: number;
  mats: number;
  status: 'setup' | 'running' | 'complete';
  visibility: 'open' | 'private';
  join_code: string | null;
}

export interface TournamentStanding {
  user_id: string;
  display_name: string;
  belt_rank: BeltRank;
  rating: number;
  wins: number;
}

export interface TournamentStandingPro {
  user_id: string; // entrant profile id OR team id
  played: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  name?: string; // resolved display name (player) or team name
  belt_rank?: BeltRank;
}

export interface TournamentTeam {
  id: string;
  tournament_id: string;
  name: string;
  captain_id: string | null;
  seed: number | null;
  members?: { user_id: string; slot: number | null; display_name: string; belt_rank: BeltRank }[];
}

export interface TournamentMat {
  id: string;
  tournament_id: string;
  mat_no: number;
  referee_id: string | null;
  referee?: { display_name: string } | null;
}

export interface TournamentBout {
  id: string;
  tournament_id: string;
  bracket: 'main' | 'losers' | 'playoff';
  round_no: number;
  position: number;
  a_entrant: string | null;
  b_entrant: string | null;
  a_team: string | null;
  b_team: string | null;
  mat_id: string | null;
  referee_id: string | null;
  status: 'pending' | 'live' | 'done' | 'bye';
  winner: 'a' | 'b' | 'draw' | null;
  result: ResultType | null;
  sub_category: 'kill' | 'break' | null;
  a_score: number;
  b_score: number;
  a_idx: number;
  b_idx: number;
  match_id: string | null;
  next_bout_id: string | null;
  next_slot: 'a' | 'b' | null;
  // resolved labels
  a_name?: string | null;
  b_name?: string | null;
}

// ---------------------------------------------------------------------------
// Community: gyms, gym friendships, open mats
// ---------------------------------------------------------------------------
export interface Gym {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  continent: string | null;
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
  state: string | null;
  country: string | null;
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
  /** null when the referee is waived (both competitors confirm the result instead). */
  referee_id: string | null;
  referee_waived: boolean;
  /** on a waived match: the competitor who logged the pending result. */
  result_proposed_by: string | null;
  status: MatchStatus;
  winner_id: string | null;
  result: ResultType | null;
  method: string | null;
  notes: string | null;
  wager: number;
  is_public: boolean;
  meet_when: string | null;
  meet_where: string | null;
  /** set when the match belongs to a league season */
  league_id: string | null;
  league_week: number | null;
  /** submission category for league scoring: 'kill' (choke) vs 'break' (joint lock) */
  sub_category: 'kill' | 'break' | null;
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

/**
 * Structured payload for client-side notification localization. The DB triggers
 * fill this alongside the English `title`/`body` fallback; the app renders the
 * display text in the member's current language from `k` + params (see
 * localizeNotification in lib/notifications.ts). Older rows have `data = null`,
 * in which case the stored English title/body is shown.
 */
export interface NotificationData {
  k: string; // render-kind, e.g. 'challenge.new' | 'result.win' | 'gym.request'
  name?: string;
  c?: string; // challenger display name (referee.ready)
  o?: string; // opponent display name (referee.ready)
  rb?: number | string; // rating before (result.*)
  ra?: number | string; // rating after (result.*)
  emoji?: string; // reaction emoji
  snippet?: string; // message preview
  gym?: string; // gym name (gym.request)
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: NotificationData | null;
  match_id: string | null;
  read: boolean;
  created_at: string;
}

// A match row joined with the three people's profiles (used in lists / detail).
export interface MatchWithPeople extends Match {
  challenger: Pick<Profile, 'id' | 'username' | 'display_name' | 'belt_rank' | 'rating'>;
  opponent: Pick<Profile, 'id' | 'username' | 'display_name' | 'belt_rank' | 'rating'>;
  referee: Pick<Profile, 'id' | 'username' | 'display_name' | 'belt_rank' | 'rating'> | null;
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
  // Written-puzzle extras from the AI grader (display only):
  strengths?: string[]; // what the answer got right
  missing?: string[]; // key points missing or wrong
  model_answer?: string | null; // a strong answer at the student's belt level
  low_effort?: boolean; // gibberish / off-topic / gaming attempt
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
