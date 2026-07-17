// Hand-written types that mirror supabase/schema.sql.
// Keep these in sync with the schema (or later generate them with the Supabase CLI).

export type BeltRank =
  // adult belts
  | 'white' | 'blue' | 'purple' | 'brown' | 'black'
  // IBJJF youth belts: gray/yellow/orange/green each solid, white-stripe, black-stripe
  | 'gray_white' | 'gray' | 'gray_black'
  | 'yellow_white' | 'yellow' | 'yellow_black'
  | 'orange_white' | 'orange' | 'orange_black'
  | 'green_white' | 'green' | 'green_black';

/** Adult belts (shown at self sign-up). */
export const ADULT_BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

/** Youth belts (shown when creating a minor), in progression order. */
export const YOUTH_BELTS: BeltRank[] = [
  'white',
  'gray_white', 'gray', 'gray_black',
  'yellow_white', 'yellow', 'yellow_black',
  'orange_white', 'orange', 'orange_black',
  'green_white', 'green', 'green_black',
];

/** The stripe overlay on a youth belt, if any. */
export function beltStripe(belt: BeltRank): 'white' | 'black' | null {
  if (belt.endsWith('_white')) return 'white';
  if (belt.endsWith('_black')) return 'black';
  return null;
}

/** Age tier, computed server-side from the member's birthdate. */
export type AgeTier = 'adult' | 'teen' | 'kid';
/** Parental-consent state for minor accounts. */
export type ConsentStatus = 'not_required' | 'pending' | 'verified';

export type MatchStatus =
  | 'pending_opponent'
  | 'pending_referee'
  | 'pending_confirmation'
  | 'completed'
  | 'disputed'
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
  /** Self-reported weight in pounds — powers the weight-class leaderboards. */
  weight_lbs: number | null;
  /** Self-reported competition gender for division eligibility. Null until set. */
  gender: 'male' | 'female' | null;
  wins: number;
  losses: number;
  draws: number;
  gym_id: string | null;
  open_for_challenge: boolean;
  city: string | null;
  state: string | null;
  country: string | null;
  continent: string | null;
  activity_streak: number;
  last_active_date: string | null;
  is_minor: boolean;
  /** Admin: can manage the app (flag founding members, etc.). */
  is_admin: boolean;
  /** Suspended for violating community guidelines (App Store 1.2). Signed out on load. */
  banned: boolean;
  /** Founding member: gold badge everywhere + free access (comp entitlement). */
  is_founding_member: boolean;
  /** Gym account: free organizer account - never competes or ranks. */
  is_gym_account: boolean;
  /** Gym account passed the owner's verification (unlocks Elite grants etc.). */
  gym_verified: boolean;
  birthdate: string | null;
  age_tier: AgeTier;
  consent_status: ConsentStatus;
  /** For a parent-managed junior: the guardian's profile id. Null otherwise. */
  managed_by: string | null;
  /** False for a guardian account: pays and manages children but does not
   *  compete; hidden from leaderboards and match search. */
  participating: boolean;
  /** True for a non-member competitor entered by a tournament host (no real
   *  auth account). Also hidden from search/leaderboards via participating=false. */
  is_guest: boolean;
  /** Per-category push toggles. Missing key = enabled. Keys are NotifCategory. */
  notif_prefs: Record<string, boolean> | null;
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
  period?: 'week' | 'once'; // 'week' = repeats weekly; 'once' = one-time challenge
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
  /** How a bout is scored + the federation preset (parity with tournaments). */
  scoring: LeagueScoring;
  ruleset_preset: LeagueRulesetPreset;
  /** Team format: 'none' = individuals; 'duel' = 2v2/3v3; 'quintet' = 5v5 survivor. */
  team_rule: LeagueTeamRule;
  team_size: number; // 1 | 2 | 3 | 5
  created_at: string;
  /** present on rows fetched with membership context */
  member_count?: number;
  is_member?: boolean;
  is_organizer?: boolean;
}

export type LeagueTeamRule = 'none' | 'duel' | 'quintet';

/** The four selectable league formats, each mapping to a (team_rule, team_size). */
export type LeagueFormat = 'individuals' | 'duo' | 'trio' | 'quintet';
export const LEAGUE_FORMATS: Record<LeagueFormat, { rule: LeagueTeamRule; size: number }> = {
  individuals: { rule: 'none', size: 1 },
  duo: { rule: 'duel', size: 2 },
  trio: { rule: 'duel', size: 3 },
  quintet: { rule: 'quintet', size: 5 },
};

export interface LeagueTeamMember {
  user_id: string;
  display_name: string;
  belt_rank: BeltRank;
  slot: number | null;
}
export interface LeagueTeam {
  id: string;
  name: string;
  captain_id: string | null;
  seed: number | null;
  members: LeagueTeamMember[];
}

export interface LeagueTeamFixture {
  id: string;
  week_no: number;
  bracket: 'season' | 'playoff';
  team_a: string | null;
  team_b: string | null;
  team_a_name: string | null;
  team_b_name: string | null;
  a_score: number;
  b_score: number;
  winner: 'a' | 'b' | 'draw' | null;
  status: 'pending' | 'done' | 'bye';
}

export interface LeagueTeamStanding {
  team_id: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
}

// Leagues reuse the tournament scoring/ruleset vocabularies verbatim.
export type LeagueScoring = TournamentScoring;
export type LeagueRulesetPreset = TournamentRulesetPreset;

// A division inside a league. Mirrors TournamentDivision minus the bracket
// `format` (a league division is always the weekly circle method) plus optional
// per-division scoring overrides (null = inherit the league's scheme).
export interface LeagueDivision {
  id: string;
  name: string;
  ruleset: 'gi' | 'nogi' | 'any';
  belt_min: BeltRank | null;
  belt_max: BeltRank | null;
  age_min: number | null;
  age_max: number | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  weight_unit: 'lbs' | 'kg';
  rating_min: number | null;
  rating_max: number | null;
  gender: 'any' | 'male' | 'female';
  open: boolean;
  status: string;
  win_points: number | null;
  draw_points: number | null;
  loss_points: number | null;
  sub_kill_bonus: number | null;
  sub_break_bonus: number | null;
  entrant_count: number;
}

// A league division the signed-in competitor could join (eligible_league_divisions).
export interface EligibleLeagueDivision {
  division_id: string;
  name: string;
  gender: 'any' | 'male' | 'female';
  weight_unit: 'lbs' | 'kg';
  open: boolean;
  eligible: boolean;
  already: boolean;
  note: string;
  fit: { belt: boolean; age: boolean; weight: boolean; rating: boolean; gender: boolean };
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
  /** Set when the pairing came from a league division; null on legacy single-pool weeks. */
  division_id: string | null;
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

export interface LeagueMessage {
  id: string;
  league_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: { display_name: string } | null;
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
/** How a bout is won. */
export type TournamentScoring = 'submission_only' | 'points';
/** Federation rules framework; 'custom' = host sets everything by hand. */
export type TournamentRulesetPreset = 'naga' | 'ibjjf' | 'grappling_industries' | 'adcc' | 'custom';

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
  city: string | null;
  scoring: TournamentScoring;
  ruleset_preset: TournamentRulesetPreset;
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
  /** Set when the bout belongs to a division bracket; null on legacy whole-event brackets. */
  division_id: string | null;
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

// A division (belt/age/weight/gender/rating bracket) inside a tournament.
// Weight bounds are stored canonically in KG; `weight_unit` remembers the unit
// the host typed them in so summaries can echo it back.
export interface TournamentDivision {
  id: string;
  name: string;
  /** Gi vs No-Gi: a bracket-separating dimension (no-gi weight limits run lighter). */
  ruleset: 'gi' | 'nogi' | 'any';
  belt_min: BeltRank | null;
  belt_max: BeltRank | null;
  age_min: number | null;
  age_max: number | null;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  weight_unit: 'lbs' | 'kg';
  rating_min: number | null;
  rating_max: number | null;
  gender: 'any' | 'male' | 'female';
  format: TournamentFormat | null;
  open: boolean;
  status: string;
  entrant_count: number;
}

// A division the signed-in competitor could join, with the computed eligibility
// state (see eligible_divisions RPC). `fit` breaks eligibility down per axis.
export interface EligibleDivision {
  division_id: string;
  name: string;
  gender: 'any' | 'male' | 'female';
  weight_unit: 'lbs' | 'kg';
  open: boolean;
  eligible: boolean;
  already: boolean;
  note: string;
  fit: { belt: boolean; age: boolean; weight: boolean; rating: boolean; gender: boolean };
}

// One entrant in a division roster (member or host-entered guest), as returned
// by the division_roster RPC — the fields a host needs to eyeball seeding.
export interface DivisionRosterEntry {
  user_id: string;
  display_name: string;
  belt_rank: BeltRank;
  gender: 'male' | 'female' | null;
  weight_lbs: number | null;
  rating: number;
  is_guest: boolean;
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
export type SubmissionCategory = 'choke' | 'arm' | 'leg' | 'spine';
export interface SubmissionDef { name: string; ror: number; category: SubmissionCategory }

// The Submission Hunt set. `ror` is the bonus Elo awarded the first time you win
// with each (claimed on the Submission Hunt screen). `name` is the canonical
// submission_type stored on a match by the referee's dropdown pick — keep names
// stable so existing collections and the server reward table stay aligned.
export const SUBMISSION_LIST: SubmissionDef[] = [
  // Chokes & strangles
  { name: 'Rear naked choke', ror: 12, category: 'choke' },
  { name: 'Guillotine', ror: 12, category: 'choke' },
  { name: 'Arm-in guillotine', ror: 16, category: 'choke' },
  { name: 'Mounted triangle', ror: 18, category: 'choke' },
  { name: 'Side triangle', ror: 20, category: 'choke' },
  { name: 'Reverse triangle', ror: 22, category: 'choke' },
  { name: 'Inverted triangle', ror: 22, category: 'choke' },
  { name: 'Ezekiel', ror: 18, category: 'choke' },
  { name: 'Bow and arrow', ror: 18, category: 'choke' },
  { name: 'Cross collar', ror: 14, category: 'choke' },
  { name: 'Clock choke', ror: 18, category: 'choke' },
  { name: 'Loop choke', ror: 20, category: 'choke' },
  { name: 'Baseball bat choke', ror: 24, category: 'choke' },
  { name: 'Paper cutter', ror: 20, category: 'choke' },
  { name: 'Arm triangle', ror: 15, category: 'choke' },
  { name: "D'Arce/Brabo", ror: 20, category: 'choke' },
  { name: 'Anaconda', ror: 20, category: 'choke' },
  { name: 'North-south', ror: 20, category: 'choke' },
  { name: 'Peruvian necktie', ror: 28, category: 'choke' },
  { name: 'Japanese necktie', ror: 28, category: 'choke' },
  { name: 'Von Flue', ror: 30, category: 'choke' },
  { name: 'Bulldog', ror: 24, category: 'choke' },
  { name: 'Gogoplata', ror: 35, category: 'choke' },
  { name: 'Buggy choke', ror: 30, category: 'choke' },
  { name: 'Murder choke', ror: 26, category: 'choke' },
  { name: 'Smother', ror: 26, category: 'choke' },
  { name: "Mother's milk", ror: 30, category: 'choke' },
  { name: 'Short choke', ror: 22, category: 'choke' },
  // Arm locks
  { name: 'Armbar', ror: 12, category: 'arm' },
  { name: 'Kimura', ror: 14, category: 'arm' },
  { name: 'Americana', ror: 14, category: 'arm' },
  { name: 'Omoplata', ror: 20, category: 'arm' },
  { name: 'Monoplata', ror: 25, category: 'arm' },
  { name: 'Bicep slicer', ror: 22, category: 'arm' },
  { name: 'Wrist lock', ror: 18, category: 'arm' },
  { name: 'Thunder lock', ror: 30, category: 'arm' },
  { name: 'Violin armbar', ror: 26, category: 'arm' },
  { name: 'Shotgun armbar', ror: 26, category: 'arm' },
  { name: 'Choi bar', ror: 30, category: 'arm' },
  { name: 'Straight arm lock', ror: 14, category: 'arm' },
  { name: 'Reverse omoplata', ror: 28, category: 'arm' },
  // Leg locks
  { name: 'Straight ankle lock', ror: 15, category: 'leg' },
  { name: 'Kneebar', ror: 22, category: 'leg' },
  { name: 'Toe hold', ror: 22, category: 'leg' },
  { name: 'Heel hook', ror: 28, category: 'leg' },
  { name: 'Calf slicer', ror: 22, category: 'leg' },
  { name: 'Aoki lock', ror: 30, category: 'leg' },
  { name: 'Z-lock', ror: 30, category: 'leg' },
  { name: 'Banana split/electric chair', ror: 28, category: 'leg' },
  { name: 'Woj lock', ror: 30, category: 'leg' },
  { name: 'Texas cloverleaf', ror: 26, category: 'leg' },
  { name: 'Mikey lock', ror: 28, category: 'leg' },
  // Spine & neck
  { name: 'Twister', ror: 32, category: 'spine' },
];

export const SUBMISSIONS: string[] = SUBMISSION_LIST.map((s) => s.name);
export const SUBMISSION_ROR: Record<string, number> = Object.fromEntries(
  SUBMISSION_LIST.map((s) => [s.name, s.ror]),
);
export const SUBMISSION_CATEGORIES: { key: SubmissionCategory; label: string }[] = [
  { key: 'choke', label: 'Chokes & strangles' },
  { key: 'arm', label: 'Arm locks' },
  { key: 'leg', label: 'Leg locks' },
  { key: 'spine', label: 'Spine & neck' },
];

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
  tid?: string; // tournament id (tournament.invite)
  lid?: string; // league id (league.invite)
  fid?: string; // friend id (friend.request / friend.accepted)
  amt?: string; // formatted dollar amount (affiliate.statement)
  n?: string; // count (affiliate.statement)
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

// A person the organizer/host has invited to a league or tournament, with the
// current state of that invite (used by the Invite players screen).
export interface SentInvite {
  user_id: string;
  display_name: string;
  username: string;
  belt_rank: string;
  rating: number;
  status: 'pending' | 'accepted' | 'declined';
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
  gray_white: 'Gray/White', gray: 'Gray', gray_black: 'Gray/Black',
  yellow_white: 'Yellow/White', yellow: 'Yellow', yellow_black: 'Yellow/Black',
  orange_white: 'Orange/White', orange: 'Orange', orange_black: 'Orange/Black',
  green_white: 'Green/White', green: 'Green', green_black: 'Green/Black',
};

// Youth stripe variants share their base color; the white/black stripe is drawn
// separately (see BeltChip + beltStripe).
export const BELT_COLORS: Record<BeltRank, string> = {
  white: '#D6D6DB',
  blue: '#2E6BE6',
  purple: '#8B5CF6',
  brown: '#7C4A1E',
  black: '#111111',
  gray_white: '#9AA0A6', gray: '#9AA0A6', gray_black: '#9AA0A6',
  yellow_white: '#F2C200', yellow: '#F2C200', yellow_black: '#F2C200',
  orange_white: '#E8781E', orange: '#E8781E', orange_black: '#E8781E',
  green_white: '#2F9E44', green: '#2F9E44', green_black: '#2F9E44',
};

/** Belts whose base color is light, so they need dark text/border on a chip. */
export function beltNeedsDarkText(belt: BeltRank): boolean {
  return belt === 'white' || belt.startsWith('gray') || belt.startsWith('yellow');
}

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
// Match videos
// ---------------------------------------------------------------------------
export interface MatchVideo {
  id: string;
  match_id: string;
  uploader_id: string;
  path: string;
  created_at: string;
}
