import { supabase } from './supabase';
import type { MatchWithPeople, Profile, ResultType } from './types';

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
}): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      challenger_id: args.challengerId,
      opponent_id: args.opponentId,
      referee_id: args.refereeId,
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
