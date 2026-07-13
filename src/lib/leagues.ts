import { supabase } from './supabase';
import type {
  BeltRank,
  EligibleLeagueDivision,
  League,
  LeagueDivision,
  LeagueFixture,
  LeagueMember,
  LeagueMessage,
  LeagueRulesetPreset,
  LeagueScoring,
  LeagueStanding,
  SentInvite,
} from './types';

const numOrNull = (v: any): number | null => (v == null ? null : Number(v));

const PERSON = 'id,display_name,belt_rank,rating';
const MEMBER_SELECT = `*, profile:profiles!league_members_user_id_fkey(${PERSON},avatar_path)`;
const FIXTURE_SELECT = `*, a:profiles!league_fixtures_player_a_fkey(id,display_name,belt_rank), b:profiles!league_fixtures_player_b_fkey(id,display_name,belt_rank)`;

/** Leagues the user belongs to. */
export async function fetchMyLeagues(userId: string): Promise<League[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select('role, league:leagues(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => r.league)
    .map((r: any) => ({ ...r.league, is_member: true, is_organizer: r.role === 'organizer' })) as League[];
}

/** Publicly listed leagues to browse/join. */
export async function fetchOpenLeagues(opts: { city?: string; audience?: string } = {}): Promise<League[]> {
  let q = supabase.from('leagues').select('*').eq('visibility', 'open').order('created_at', { ascending: false }).limit(100);
  if (opts.city?.trim()) q = q.ilike('city', `%${opts.city.trim()}%`);
  if (opts.audience && opts.audience !== 'all') q = q.eq('audience', opts.audience);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as League[];
}

export async function fetchLeague(id: string): Promise<League | null> {
  const { data, error } = await supabase.from('leagues').select('*').eq('id', id).single();
  if (error) return null;
  return data as League;
}

export async function fetchMembers(leagueId: string): Promise<LeagueMember[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select(MEMBER_SELECT)
    .eq('league_id', leagueId)
    .eq('active', true)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LeagueMember[];
}

export async function createLeague(args: {
  createdBy: string;
  name: string;
  description?: string;
  audience: 'all' | 'kids' | 'adults';
  ranked: boolean;
  visibility: 'open' | 'private';
  meetDay: number;
  meetTime?: string;
  location?: string;
  city?: string;
  seasonStarts: string; // YYYY-MM-DD
  weeks: number;
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  subKillBonus: number;
  subBreakBonus: number;
  scoring: LeagueScoring;
  rulesetPreset: LeagueRulesetPreset;
}): Promise<League> {
  const { data, error } = await supabase
    .from('leagues')
    .insert({
      created_by: args.createdBy,
      name: args.name.trim(),
      description: args.description?.trim() || null,
      audience: args.audience,
      ranked: args.ranked,
      visibility: args.visibility,
      meet_day: args.meetDay,
      meet_time: args.meetTime?.trim() || null,
      location: args.location?.trim() || null,
      city: args.city?.trim() || null,
      season_starts: args.seasonStarts,
      weeks: args.weeks,
      win_points: args.winPoints,
      draw_points: args.drawPoints,
      loss_points: args.lossPoints,
      sub_kill_bonus: args.subKillBonus,
      sub_break_bonus: args.subBreakBonus,
      scoring: args.scoring,
      ruleset_preset: args.rulesetPreset,
    })
    .select('*')
    .single();
  if (error) throw error;
  const league = data as League;
  // The creator is the organizer + first member.
  const { error: mErr } = await supabase
    .from('league_members')
    .insert({ league_id: league.id, user_id: args.createdBy, role: 'organizer', joined_week: 1 });
  if (mErr) throw mErr;
  return league;
}

export async function joinLeague(userId: string, leagueId: string): Promise<void> {
  const { error } = await supabase
    .from('league_members')
    .upsert({ league_id: leagueId, user_id: userId, role: 'member', active: true }, { onConflict: 'league_id,user_id' });
  if (error) throw error;
}

/** Join via a shared code; returns the league id. */
export async function joinLeagueByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_league_by_code', { p_code: code });
  if (error) throw error;
  return data as string;
}

export async function leaveLeague(userId: string, leagueId: string): Promise<void> {
  const { error } = await supabase.from('league_members').delete().eq('league_id', leagueId).eq('user_id', userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Invites — the organizer invites specific people (who accept to join)
// ---------------------------------------------------------------------------
export interface LeagueInvite {
  league_id: string;
  name: string;
  invited_by_name: string;
  created_at: string;
}

/** Organizer invites a user to their league. */
export async function inviteToLeague(leagueId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('invite_to_league', { p_lid: leagueId, p_user: userId });
  if (error) throw error;
}

/** Organizer invites several people at once; returns how many invites went out. */
export async function inviteManyToLeague(leagueId: string, userIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('invite_many_to_league', { p_lid: leagueId, p_users: userIds });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Everyone the organizer has invited to this league, with status. Organizer only. */
export async function fetchLeagueInvitesSent(leagueId: string): Promise<SentInvite[]> {
  const { data, error } = await supabase.rpc('league_invites_sent', { p_lid: leagueId });
  if (error) throw error;
  return (data ?? []) as SentInvite[];
}

/** Invited user accepts (joins) or declines. */
export async function respondLeagueInvite(leagueId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_league_invite', { p_lid: leagueId, p_accept: accept });
  if (error) throw error;
}

/** Pending league invites for the signed-in user. */
export async function fetchMyLeagueInvites(): Promise<LeagueInvite[]> {
  const { data, error } = await supabase.rpc('my_league_invites');
  if (error) throw error;
  return (data ?? []) as LeagueInvite[];
}

/** Whether the signed-in user has a pending invite to this league. */
export async function hasLeagueInvite(leagueId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_league_invite', { p_lid: leagueId });
  if (error) return false;
  return !!data;
}

export async function fetchFixtures(leagueId: string, week: number): Promise<LeagueFixture[]> {
  const { data, error } = await supabase
    .from('league_fixtures')
    .select(FIXTURE_SELECT)
    .eq('league_id', leagueId)
    .eq('week_no', week)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LeagueFixture[];
}

/** Organizer: auto-pair the given week (idempotent). */
export async function generateWeek(leagueId: string, week: number): Promise<void> {
  const { error } = await supabase.rpc('generate_league_week', { p_league_id: leagueId, p_week: week });
  if (error) throw error;
}

/** Standings (numbers from the server scoring fn) merged with member profiles. */
export async function fetchStandings(leagueId: string): Promise<LeagueStanding[]> {
  const { data, error } = await supabase.rpc('league_standings', { p_league_id: leagueId });
  if (error) throw error;
  const rows = (data ?? []) as LeagueStanding[];
  if (rows.length === 0) return rows;
  const { data: profs } = await supabase
    .from('profiles')
    .select(PERSON)
    .in('id', rows.map((r) => r.user_id));
  const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: byId.get(r.user_id) ?? null }));
}

// --- League announcements (organizer posts; members are notified) ----------
export async function fetchLeagueMessages(leagueId: string): Promise<LeagueMessage[]> {
  const { data, error } = await supabase
    .from('league_messages')
    .select('*, author:profiles(display_name)')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as LeagueMessage[];
}

export async function postLeagueMessage(leagueId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('post_league_message', { p_lid: leagueId, p_body: body });
  if (error) throw error;
}

/** Link the match a fixture was played as (called after creating a league match). */
export async function linkFixtureMatch(leagueId: string, week: number, userA: string, userB: string, matchId: string): Promise<void> {
  const { data } = await supabase
    .from('league_fixtures')
    .select('id, player_a, player_b')
    .eq('league_id', leagueId)
    .eq('week_no', week);
  const fixture = (data ?? []).find(
    (f: any) =>
      (f.player_a === userA && f.player_b === userB) || (f.player_a === userB && f.player_b === userA),
  );
  if (!fixture) return;
  await supabase.from('league_fixtures').update({ match_id: matchId }).eq('id', (fixture as any).id);
}

/** 1-based current week of a league, clamped to its length. */
export function currentLeagueWeek(league: Pick<League, 'season_starts' | 'weeks'>): number {
  const start = new Date(league.season_starts + 'T00:00:00').getTime();
  const days = Math.floor((Date.now() - start) / 86_400_000);
  return Math.max(1, Math.min(league.weeks, Math.floor(days / 7) + 1));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// League divisions (belt/age/weight/rating/gender + Gi/No-Gi), mirroring the
// tournament division lib. Divisions are optional; a league with none keeps its
// legacy single-pool behavior.
// ---------------------------------------------------------------------------

/** All divisions of a league with entrant counts (organizer builder + browse). */
export async function fetchLeagueDivisions(leagueId: string): Promise<LeagueDivision[]> {
  const { data, error } = await supabase.rpc('league_divisions_list', { p_league: leagueId });
  if (error) throw error;
  return ((data ?? []) as any[]).map((d) => ({
    id: d.id,
    name: d.name,
    ruleset: (d.ruleset ?? 'any') as 'gi' | 'nogi' | 'any',
    belt_min: d.belt_min ?? null,
    belt_max: d.belt_max ?? null,
    age_min: numOrNull(d.age_min),
    age_max: numOrNull(d.age_max),
    weight_min_kg: numOrNull(d.weight_min_kg),
    weight_max_kg: numOrNull(d.weight_max_kg),
    weight_unit: (d.weight_unit ?? 'lbs') as 'lbs' | 'kg',
    rating_min: numOrNull(d.rating_min),
    rating_max: numOrNull(d.rating_max),
    gender: (d.gender ?? 'any') as 'any' | 'male' | 'female',
    open: !!d.open,
    status: d.status ?? 'setup',
    win_points: numOrNull(d.win_points),
    draw_points: numOrNull(d.draw_points),
    loss_points: numOrNull(d.loss_points),
    sub_kill_bonus: numOrNull(d.sub_kill_bonus),
    sub_break_bonus: numOrNull(d.sub_break_bonus),
    entrant_count: Number(d.entrant_count ?? 0),
  }));
}

/** Organizer creates a division. Weight bounds are passed as canonical KG. */
export async function createLeagueDivision(args: {
  leagueId: string;
  name: string;
  beltMin?: BeltRank | null;
  beltMax?: BeltRank | null;
  ageMin?: number | null;
  ageMax?: number | null;
  weightMinKg?: number | null;
  weightMaxKg?: number | null;
  weightUnit?: 'lbs' | 'kg';
  ratingMin?: number | null;
  ratingMax?: number | null;
  gender?: 'any' | 'male' | 'female';
  open?: boolean;
  ruleset?: 'gi' | 'nogi' | 'any';
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_league_division', {
    p_league: args.leagueId,
    p_name: args.name.trim(),
    p_belt_min: args.beltMin ?? null,
    p_belt_max: args.beltMax ?? null,
    p_age_min: args.ageMin ?? null,
    p_age_max: args.ageMax ?? null,
    p_wmin_kg: args.weightMinKg ?? null,
    p_wmax_kg: args.weightMaxKg ?? null,
    p_weight_unit: args.weightUnit ?? 'lbs',
    p_rating_min: args.ratingMin ?? null,
    p_rating_max: args.ratingMax ?? null,
    p_gender: args.gender ?? 'any',
    p_open: args.open ?? false,
    p_ruleset: args.ruleset ?? 'any',
    // per-division scoring overrides omitted -> inherit the league's scheme
  });
  if (error) throw error;
  return data as string;
}

/** Organizer deletes a division. */
export async function deleteLeagueDivision(divisionId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_league_division', { p_division: divisionId });
  if (error) throw error;
}

/** Divisions the signed-in member could join, with computed eligibility. */
export async function fetchEligibleLeagueDivisions(leagueId: string): Promise<EligibleLeagueDivision[]> {
  const { data, error } = await supabase.rpc('eligible_league_divisions', { p_league: leagueId });
  if (error) throw error;
  return ((data ?? []) as any[]).map((d) => ({
    division_id: d.division_id,
    name: d.name,
    gender: (d.gender ?? 'any') as 'any' | 'male' | 'female',
    weight_unit: (d.weight_unit ?? 'lbs') as 'lbs' | 'kg',
    open: !!d.open,
    eligible: !!d.eligible,
    already: !!d.already,
    note: d.note ?? 'ineligible',
    fit: {
      belt: !!d.fit?.belt,
      age: !!d.fit?.age,
      weight: !!d.fit?.weight,
      rating: !!d.fit?.rating,
      gender: !!d.fit?.gender,
    },
  }));
}

/**
 * Member self-registers into a league division (also joins the league).
 * `weightLbs`/`gender` fill any missing profile fields (never overwriting).
 */
export async function registerLeagueDivision(
  divisionId: string,
  opts: { weightLbs?: number | null; gender?: 'male' | 'female' | null } = {},
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc('register_league_division', {
    p_division: divisionId,
    p_weight_lbs: opts.weightLbs ?? null,
    p_gender: opts.gender ?? null,
  });
  if (error) throw error;
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  return { ok: !!r.ok, reason: r.reason ?? 'ineligible' };
}
