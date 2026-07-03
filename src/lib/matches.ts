import { resolveGeo, type Geo } from './geo';
import { fetchBlockedIds } from './safety';
import { getCachedUser, supabase } from './supabase';
import type { BeltRank, MatchWithPeople, Profile, ResultType } from './types';

export interface WagerLeader {
  user_id: string;
  display_name: string;
  belt_rank: BeltRank;
  rating: number;
  pot_won: number;
  wagered_wins: number;
  // Resolved location + gym for scope filtering (profile first, gym fallback).
  geo: Geo;
  gym_id: string | null;
}

// ---------------------------------------------------------------------------
// Public matches: feed, views, reactions
// ---------------------------------------------------------------------------
export async function fetchPublicMatches(): Promise<MatchWithPeople[]> {
  const [{ data, error }, blocked] = await Promise.all([
    supabase
      .from('matches')
      .select(MATCH_WITH_PEOPLE)
      .eq('is_public', true)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(50),
    fetchBlockedIds(),
  ]);
  if (error) throw error;
  // App Store 1.2: a block removes that user's content from your feed instantly.
  const hide = new Set(blocked);
  return (data ?? []).filter(
    (m: any) => !hide.has(m.challenger_id) && !hide.has(m.opponent_id),
  ) as unknown as MatchWithPeople[];
}

/** Filters for the Watch feed search. */
export interface WatchFilters {
  search?: string;
  level?: string; // gym | city | state | country | continent | world
  belt?: BeltRank | null;
  minRating?: number | null;
  maxRating?: number | null;
  submission?: string | null;
  sort?: string; // recent | views | reactions | wager
}

/**
 * Search + filter public completed matches. The RPC does the filtering (name
 * search on either competitor, geo scope viewer-relative, belt, rating band,
 * submission) and returns ordered ids; we fetch the full cards for them, hide
 * blocked users, and preserve the RPC's newest-first order.
 */
export async function searchPublicMatches(filters: WatchFilters = {}): Promise<MatchWithPeople[]> {
  const { data: idRows, error } = await supabase.rpc('search_public_match_ids', {
    p_search: filters.search?.trim() || null,
    p_level: filters.level || 'world',
    p_belt: filters.belt || null,
    p_min_rating: filters.minRating ?? null,
    p_max_rating: filters.maxRating ?? null,
    p_submission: filters.submission || null,
    p_sort: filters.sort || 'recent',
    p_limit: 50,
  });
  if (error) throw error;
  const ids = ((idRows ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return [];

  const [{ data, error: mErr }, blocked] = await Promise.all([
    supabase.from('matches').select(MATCH_WITH_PEOPLE).in('id', ids),
    fetchBlockedIds(),
  ]);
  if (mErr) throw mErr;
  const order = new Map(ids.map((id, i) => [id, i]));
  const hide = new Set(blocked);
  return (data ?? [])
    .filter((m: any) => !hide.has(m.challenger_id) && !hide.has(m.opponent_id))
    .sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) as unknown as MatchWithPeople[];
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
/**
 * Newest `limit` messages, returned oldest-first for rendering. Pass `before`
 * (the created_at of the oldest loaded message) to page further back.
 */
export async function fetchMatchMessages(matchId: string, opts?: { limit?: number; before?: string }) {
  let req = supabase
    .from('match_messages')
    .select('*, sender:profiles!match_messages_sender_id_fkey(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 50);
  if (opts?.before) req = req.lt('created_at', opts.before);
  const { data, error } = await req;
  if (error) throw error;
  return ((data ?? []) as unknown as import('./types').MatchMessage[]).reverse();
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

/** Top players by total Elo won through wagers ("Biggest Pots"), with each
 *  leader's resolved location + gym attached for scope filtering. */
export async function fetchWagerLeaderboard(): Promise<WagerLeader[]> {
  const { data, error } = await supabase.rpc('wager_leaderboard', { p_limit: 50 });
  if (error) throw error;
  const base = (data ?? []).map((r: any) => ({
    ...r,
    pot_won: Number(r.pot_won),
    wagered_wins: Number(r.wagered_wins),
  }));

  // Enrich with geo/gym in one extra query (the RPC doesn't return location).
  const ids = base.map((r: any) => r.user_id);
  const geoById = new Map<string, { geo: Geo; gym_id: string | null }>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, city, state, country, continent, gym_id, gym:gyms!profiles_gym_id_fkey(city,state,country,continent)')
      .in('id', ids);
    for (const p of (profs ?? []) as any[]) {
      geoById.set(p.id, {
        geo: resolveGeo({ city: p.city, state: p.state, country: p.country, continent: p.continent }, p.gym ?? null),
        gym_id: p.gym_id ?? null,
      });
    }
  }

  return base.map((r: any) => ({
    ...r,
    geo: geoById.get(r.user_id)?.geo ?? { city: null, state: null, country: null, continent: null },
    gym_id: geoById.get(r.user_id)?.gym_id ?? null,
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
export async function fetchMyMatches(userId: string, limit = 100): Promise<MatchWithPeople[]> {
  const { data: juniors } = await supabase.from('profiles').select('id').eq('managed_by', userId);
  const ids = [userId, ...((juniors ?? []) as { id: string }[]).map((j) => j.id)];
  const orClause = ids
    .flatMap((id) => [`challenger_id.eq.${id}`, `opponent_id.eq.${id}`, `referee_id.eq.${id}`])
    .join(',');
  // Recent history is capped; active matches are fetched separately without a
  // cap so an old still-pending match can never fall off the end of the list.
  const [recent, active] = await Promise.all([
    supabase.from('matches').select(MATCH_WITH_PEOPLE).or(orClause).order('created_at', { ascending: false }).limit(limit),
    supabase.from('matches').select(MATCH_WITH_PEOPLE).or(orClause)
      .in('status', ['pending_opponent', 'pending_referee', 'pending_confirmation', 'disputed'])
      .order('created_at', { ascending: false }),
  ]);
  if (recent.error) throw recent.error;
  if (active.error) throw active.error;
  const byId = new Map<string, MatchWithPeople>();
  for (const m of [...(recent.data ?? []), ...(active.data ?? [])] as unknown as MatchWithPeople[]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
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
 * Top adults by rating WITHIN a geographic scope (gym|city|state|country|
 * continent|world), ranked on the server so a local board isn't limited to
 * whoever happens to sit in the global top-N. The geo_leaderboard RPC resolves
 * each player's location profile-first with gym fallback (matching resolveGeo)
 * and returns only safe columns. Excludes under-14 juniors (own board).
 */
export async function fetchLeaderboard(level = 'world', limit = 200): Promise<LeaderRow[]> {
  const { data, error } = await supabase.rpc('geo_leaderboard', { p_level: level, p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    geo: { city: r.city, state: r.state, country: r.country, continent: r.continent },
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
export async function searchProfiles(
  query: string,
  excludeIds: string[],
  opts?: { gymId?: string; limit?: number },
): Promise<Profile[]> {
  let req = supabase
    .from('profiles')
    .select('*')
    .neq('age_tier', 'kid') // under-14 juniors are never searchable
    .eq('participating', true) // guardians (non-participating) aren't opponents/invitees
    .order('rating', { ascending: false })
    .limit(opts?.limit ?? 25);
  if (opts?.gymId) req = req.eq('gym_id', opts.gymId);

  const q = query.trim();
  if (q.length > 0) {
    req = req.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
  }
  const [{ data, error }, blocked, me] = await Promise.all([req, fetchBlockedIds(), getCachedUser()]);
  if (error) throw error;
  const hide = new Set([...excludeIds, ...blocked]);
  if (me) hide.add(me.id); // you should never find yourself (friends, opponents, invites)
  return (data ?? []).filter((p) => !hide.has(p.id));
}
