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

/** Matches where the user is a competitor or the referee, newest first. */
export async function fetchMyMatches(userId: string): Promise<MatchWithPeople[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_WITH_PEOPLE)
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId},referee_id.eq.${userId}`)
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
  refereeId: string;
  wager?: number;
  isPublic?: boolean;
}): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      challenger_id: args.challengerId,
      opponent_id: args.opponentId,
      referee_id: args.refereeId,
      wager: Math.max(0, Math.round(args.wager ?? 0)),
      is_public: !!args.isPublic,
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

/** Submission types the user has won with, and which have been rewarded. */
export async function fetchSubmissionCollection(userId: string): Promise<{ won: string[]; rewarded: string[] }> {
  const [{ data: wins, error: wErr }, { data: rewards, error: rErr }] = await Promise.all([
    supabase
      .from('matches')
      .select('submission_type')
      .eq('status', 'completed')
      .eq('winner_id', userId)
      .not('submission_type', 'is', null),
    supabase.from('submission_rewards').select('submission_type').eq('user_id', userId),
  ]);
  if (wErr) throw wErr;
  if (rErr) throw rErr;
  const won = [...new Set((wins ?? []).map((w: { submission_type: string }) => w.submission_type))];
  const rewarded = (rewards ?? []).map((r: { submission_type: string }) => r.submission_type);
  return { won, rewarded };
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
}) {
  const { error } = await supabase.rpc('record_match_result', {
    p_match_id: args.matchId,
    p_winner_id: args.winnerId,
    p_result: args.result,
    p_method: args.method ?? null,
    p_notes: args.notes ?? null,
  });
  if (error) throw error;
}

/** Top players by rating. */
export async function fetchLeaderboard(limit = 100): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('rating', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Search people by username / display name, excluding the given ids. */
export async function searchProfiles(query: string, excludeIds: string[]): Promise<Profile[]> {
  let req = supabase
    .from('profiles')
    .select('*')
    .order('rating', { ascending: false })
    .limit(25);

  const q = query.trim();
  if (q.length > 0) {
    req = req.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
  }
  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []).filter((p) => !excludeIds.includes(p.id));
}
