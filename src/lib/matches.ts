import { resolveGeo, type Geo } from './geo';
import { fetchBlockedIds } from './safety';
import { supabase } from './supabase';
import type { BeltRank, MatchWithPeople, Profile, ResultType } from './types';

export interface WagerLeader {
  user_id: string;
  display_name: string;
  belt_rank: BeltRank;
  rating: number;
  pot_won: number;
  wagered_wins: number;
}

// ---------------------------------------------------------------------------
// Public matches: feed, views, reactions
// ---------------------------------------------------------------------------
export async function fetchPublicMatches(): Promise<MatchWithPeople[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PEOPLE)
    .eq('is_public', true)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as MatchWithPeople[];
}

/** Record one unique view (no-op if this viewer already viewed). */
export async function recordMatchView(matchId: string, viewerId: string) {
  await supabase
    .from('match_views')
    .upsert({ match_id: matchId, viewer_id: viewerId }, { onConflict: 'match_id,viewer_id', ignoreDuplicates: true });
}

export async function fetchMatchViewCount(matchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('match_views')
    .select('viewer_id', { count: 'exact', head: true })
    .eq('match_id', matchId);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchMatchReactions(
  matchId: string,
  userId: string,
): Promise<import('./types').ReactionSummary> {
  const { data, error } = await supabase
    .from('match_reactions')
    .select('user_id,reaction')
    .eq('match_id', matchId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  let mine: string | null = null;
  for (const r of (data ?? []) as { user_id: string; reaction: string }[]) {
    counts[r.reaction] = (counts[r.reaction] ?? 0) + 1;
    if (r.user_id === userId) mine = r.reaction;
  }
  return { counts, mine };
}

/** Set (or clear, when reaction is null) the user's reaction on a match. */
export async function setMatchReaction(matchId: string, userId: string, reaction: string | null) {
  if (reaction === null) {
    const { error } = await supabase.from('match_reactions').delete().eq('match_id', matchId).eq('user_id', userId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('match_reactions')
    .upsert({ match_id: matchId, user_id: userId, reaction }, { onConflict: 'match_id,user_id' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Per-match chat + plan
// ---------------------------------------------------------------------------
export async function fetchMatchMessages(matchId: string) {
  const { data, error } = await supabase
    .from('match_messages')
    .select('*, sender:profiles!match_messages_sender_id_fkey(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as import('./types').MatchMessage[];
}

export async function sendMatchMessage(matchId: string, senderId: string, body: string) {
  const { error } = await supabase
    .from('match_messages')
    .insert({ match_id: matchId, sender_id: senderId, body: body.trim() });
  if (error) throw error;
}

export async function setMatchPlan(matchId: string, when: string, where: string) {
  const { error } = await supabase.rpc('set_match_plan', {
    p_match_id: matchId,
    p_when: when,
    p_where: where,
  });
  if (error) throw error;
}

/** Top players by total Elo won through wagers ("Biggest Pots"). */
export async function fetchWagerLeaderboard(): Promise<WagerLeader[]> {
  const { data, error } = await supabase.rpc('wager_leaderboard', { p_limit: 50 });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    pot_won: Number(r.pot_won),
    wagered_wins: Number(r.wagered_wins),
  })) as WagerLeader[];
}

// Column list used when embedding a person on a match row.
const PERSON = 'id,username,display_name,belt_rank,rating';

// Disambiguate the three foreign keys that all point at profiles.
const MATCH_WITH_PEOPLE = `
  *,
  challenger:profiles!matches_challenger_id_fkey(${PERSON}),
  opponent:profiles!matches_opponent_id_fkey(${PERSON}),
  referee:profiles!matches_referee_id_fkey(${PERSON})
`;

/**
 * Matches where the user (or a junior they manage) is a competitor or referee,
 * newest first — so a guardian sees and can act on their juniors' matches too.
 */
export async function fetchMyMatches(userId: string): Promise<MatchWithPeople[]> {
  const { data: juniors } = await supabase.from('profiles').select('id').eq('managed_by', userId);
  const ids = [userId, ...((juniors ?? []) as { id: string }[]).map((j) => j.id)];
  const orClause = ids
    .flatMap((id) => [`challenger_id.eq.${id}`, `opponent_id.eq.${id}`, `referee_id.eq.${id}`])
    .join(',');
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PEOPLE)
    .or(orClause)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MatchWithPeople[];
}

/** A single match with all three people attached. */
export async function fetchMatch(matchId: string): Promise<MatchWithPeople> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PEOPLE)
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data as unknown as MatchWithPeople;
}

/** Create a challenge. Caller is always the challenger. */
export async function createMatch(args: {
  challengerId: string;
  opponentId: string;
  refereeId: string | null;
  refereeWaived?: boolean;
  wager?: number;
  isPublic?: boolean;
  leagueId?: string | null;
  leagueWeek?: number | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      challenger_id: args.challengerId,
      opponent_id: args.opponentId,
      referee_id: args.refereeWaived ? null : args.refereeId,
      referee_waived: !!args.refereeWaived,
      // League matches are never wagered.
      wager: args.leagueId ? 0 : Math.max(0, Math.round(args.wager ?? 0)),
      is_public: !!args.isPublic,
      league_id: args.leagueId ?? null,
      league_week: args.leagueId ? args.leagueWeek ?? null : null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Opponent accepts (true) or declines (false). */
export async function respondToMatch(matchId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_to_match', {
    p_match_id: matchId,
    p_accept: accept,
  });
  if (error) throw error;
}

/** Challenger or opponent cancels before completion. */
export async function cancelMatch(matchId: string) {
  const { error } = await supabase.rpc('cancel_match', { p_match_id: matchId });
  if (error) throw error;
}

/** Referee tags the canonical submission type after recording a finish. */
export async function setSubmissionType(matchId: string, type: string) {
  const { error } = await supabase.rpc('set_submission_type', { p_match_id: matchId, p_type: type });
  if (error) throw error;
}

/**
 * Eligible submission wins (loser within 25% of the winner's rating — no farming
 * weak newbies) and which have already been rewarded. Gating lives server-side
 * in my_submission_collection so it matches claim_submission_rewards exactly.
 */
export async function fetchSubmissionCollection(_userId: string): Promise<{ won: string[]; rewarded: string[] }> {
  const { data, error } = await supabase.rpc('my_submission_collection');
  if (error) throw error;
  const d = (data ?? {}) as { won: string[] | null; rewarded: string[] | null };
  return { won: d.won ?? [], rewarded: d.rewarded ?? [] };
}

export async function claimSubmissionRewards(): Promise<{ gained: number; claimed: string[]; new_rating: number }> {
  const { data, error } = await supabase.rpc('claim_submission_rewards');
  if (error) throw error;
  return data as { gained: number; claimed: string[]; new_rating: number };
}

/** Referee records the outcome; ratings are applied server-side. */
export async function recordResult(args: {
  matchId: string;
  winnerId: string | null; // null = draw
  result: ResultType;
  method?: string | null;
  notes?: string | null;
  subCategory?: 'kill' | 'break' | null; // submission type for league scoring
}) {
  const { error } = await supabase.rpc('record_match_result', {
    p_match_id: args.matchId,
    p_winner_id: args.winnerId,
    p_result: args.result,
    p_method: args.method ?? null,
    p_notes: args.notes ?? null,
    p_sub_category: args.subCategory ?? null,
  });
  if (error) throw error;
}

/** On a waived match, the OTHER competitor confirms (true) or disputes (false) the logged result. */
export async function confirmResult(matchId: string, accept: boolean) {
  const { error } = await supabase.rpc('confirm_match_result', {
    p_match_id: matchId,
    p_accept: accept,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Non-referee result reporting + disputes
// ---------------------------------------------------------------------------
export interface MatchReport {
  match_id: string;
  reporter_id: string;
  winner_id: string | null;
  result: ResultType;
  submission_type: string | null;
  method: string | null;
}

/** A competitor reports their version of a waived match (both must agree to settle). */
export async function reportResult(args: {
  matchId: string;
  winnerId: string | null;
  result: ResultType;
  submissionType?: string | null;
  method?: string | null;
  notes?: string | null;
}) {
  const { error } = await supabase.rpc('report_match_result', {
    p_match_id: args.matchId,
    p_winner_id: args.winnerId,
    p_result: args.result,
    p_submission_type: args.submissionType ?? null,
    p_method: args.method ?? null,
    p_notes: args.notes ?? null,
  });
  if (error) throw error;
}

/** Both competitors' reports for a match (visible to the competitors + admins). */
export async function fetchMatchReports(matchId: string): Promise<MatchReport[]> {
  const { data, error } = await supabase.from('match_reports').select('*').eq('match_id', matchId);
  if (error) throw error;
  return (data ?? []) as MatchReport[];
}

export interface DisputeReport {
  reporter_id: string;
  winner_id: string | null;
  result: ResultType;
  submission_type: string | null;
  method: string | null;
}
export interface MatchDispute {
  match_id: string;
  created_at: string;
  challenger: { id: string; name: string };
  opponent: { id: string; name: string };
  video_count: number;
  reports: DisputeReport[] | null;
}

/** Admin: disputed matches awaiting an official result. */
export async function fetchDisputes(): Promise<MatchDispute[]> {
  const { data, error } = await supabase.rpc('admin_disputes');
  if (error) throw error;
  return (data ?? []) as MatchDispute[];
}

/** Admin: set the official result on a disputed match (applies ratings). */
export async function resolveDispute(args: {
  matchId: string;
  winnerId: string | null;
  result: ResultType;
  submissionType?: string | null;
  method?: string | null;
}) {
  const { error } = await supabase.rpc('admin_resolve_dispute', {
    p_match_id: args.matchId,
    p_winner_id: args.winnerId,
    p_result: args.result,
    p_submission_type: args.submissionType ?? null,
    p_method: args.method ?? null,
  });
  if (error) throw error;
}

export interface LeaderRow extends Profile {
  gym?: { city: string | null; state: string | null; country: string | null; continent: string | null } | null;
  // Resolved location used for geo-level filtering (profile first, gym fallback).
  geo: Geo;
}

/**
 * Top players by rating with their resolved location attached (for geographic
 * level filtering). Excludes under-14 juniors (they have their own board).
 */
export async function fetchLeaderboard(limit = 200): Promise<LeaderRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    // disambiguate: profiles<->gyms has two FKs (gym_id and owner_id); we want gym_id.
    .select('*, gym:gyms!profiles_gym_id_fkey(city,state,country,continent)')
    .neq('age_tier', 'kid')
    .order('rating', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    geo: resolveGeo({ city: r.city, state: r.state, country: r.country, continent: r.continent }, r.gym ?? null),
  })) as unknown as LeaderRow[];
}

/** The signed-in member's geography (profile first, gym fallback), for level filtering. */
export async function fetchMyGeo(userId: string): Promise<Geo | null> {
  const { data } = await supabase
    .from('profiles')
    .select('city, state, country, continent, gym:gyms!profiles_gym_id_fkey(city,state,country,continent)')
    .eq('id', userId)
    .single();
  if (!data) return null;
  const r = data as any;
  return resolveGeo({ city: r.city, state: r.state, country: r.country, continent: r.continent }, r.gym ?? null);
}

export interface KidsLeaderRow {
  junior_id: string;
  rank: number;
  first_name: string;
  rating: number;
}

/**
 * 13-and-under leaderboard — first name + rating only (+ an opaque junior_id so
 * a guardian can challenge a row; the kid's profile stays private). Filterable
 * by geographic level.
 */
export async function fetchKidsLeaderboard(
  level: import('./geo').GeoLevel = 'world',
  limit = 100,
): Promise<KidsLeaderRow[]> {
  const { data, error } = await supabase.rpc('kids_leaderboard', { p_level: level, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    junior_id: r.junior_id,
    rank: Number(r.rank),
    first_name: r.first_name,
    rating: r.rating,
  }));
}

/** Search people by username / display name, excluding the given ids. */
export async function searchProfiles(query: string, excludeIds: string[]): Promise<Profile[]> {
  let req = supabase
    .from('profiles')
    .select('*')
    .neq('age_tier', 'kid') // under-14 juniors are never searchable
    .order('rating', { ascending: false })
    .limit(25);

  const q = query.trim();
  if (q.length > 0) {
    req = req.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
  }
  const [{ data, error }, blocked] = await Promise.all([req, fetchBlockedIds()]);
  if (error) throw error;
  const hide = new Set([...excludeIds, ...blocked]);
  return (data ?? []).filter((p) => !hide.has(p.id));
}
