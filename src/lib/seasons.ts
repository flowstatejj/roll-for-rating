import { supabase } from './supabase';
import type { Season, SeasonStanding } from './types';

export async function fetchSeasons(): Promise<Season[]> {
  const { data, error } = await supabase.from('seasons').select('*').order('starts_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Season[];
}

export function currentSeason(seasons: Season[]): Season | null {
  const now = Date.now();
  return (
    seasons.find((s) => new Date(s.starts_at).getTime() <= now && now <= new Date(s.ends_at).getTime()) ?? null
  );
}

export async function fetchSeasonStandings(seasonId: string, limit = 100): Promise<SeasonStanding[]> {
  const { data, error } = await supabase
    .from('season_scores')
    .select('user_id, points, wins, profile:profiles!season_scores_user_id_fkey(id,display_name,belt_rank,rating)')
    .eq('season_id', seasonId)
    .order('points', { ascending: false })
    .order('wins', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as SeasonStanding[];
}
