import { supabase } from './supabase';
import type { GymPower, Tournament, TournamentStanding } from './types';

// ---------------------------------------------------------------------------
// Teams: gym power ranking
// ---------------------------------------------------------------------------
export async function fetchGymPowerRanking(): Promise<GymPower[]> {
  const { data, error } = await supabase.rpc('gym_power_ranking');
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    ...g,
    member_count: Number(g.member_count),
    total_wins: Number(g.total_wins),
  })) as GymPower[];
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------
export async function fetchTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase.from('tournaments').select('*').order('starts_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Tournament[];
}

export async function fetchTournament(id: string): Promise<Tournament> {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Tournament;
}

export async function createTournament(args: {
  name: string;
  hostId: string;
  startsAt: string;
  endsAt: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from('tournaments')
    .insert({ name: args.name.trim(), host_id: args.hostId, starts_at: args.startsAt, ends_at: args.endsAt })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function fetchEntrants(tid: string): Promise<string[]> {
  const { data, error } = await supabase.from('tournament_entrants').select('user_id').eq('tournament_id', tid);
  if (error) throw error;
  return (data ?? []).map((e: { user_id: string }) => e.user_id);
}

export async function joinTournament(tid: string, userId: string) {
  const { error } = await supabase.from('tournament_entrants').insert({ tournament_id: tid, user_id: userId });
  if (error) throw error;
}

export async function leaveTournament(tid: string, userId: string) {
  const { error } = await supabase.from('tournament_entrants').delete().eq('tournament_id', tid).eq('user_id', userId);
  if (error) throw error;
}

export async function fetchTournamentStandings(tid: string): Promise<TournamentStanding[]> {
  const { data, error } = await supabase.rpc('tournament_standings', { p_tid: tid });
  if (error) throw error;
  return (data ?? []).map((s: any) => ({ ...s, wins: Number(s.wins) })) as TournamentStanding[];
}
