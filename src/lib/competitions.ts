import { supabase } from './supabase';
import type { CompetitionImportResult, CompetitionRecord, CompSource } from './types';

/** A member's imported competition records (one per source). */
export async function fetchCompetitionRecords(userId: string): Promise<CompetitionRecord[]> {
  const { data, error } = await supabase
    .from('competition_records')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompetitionRecord[];
}

/**
 * Apply external W/L to the member's rating (flat +15 / -10, server-side).
 * Re-importing the same source replaces its previous contribution.
 */
export async function importCompetitionRecord(args: {
  source: CompSource;
  profileUrl: string;
  wins: number;
  losses: number;
  verified?: boolean;
}): Promise<CompetitionImportResult> {
  const { data, error } = await supabase.rpc('import_competition_record', {
    p_source: args.source,
    p_profile_url: args.profileUrl || null,
    p_wins: args.wins,
    p_losses: args.losses,
    p_verified: args.verified ?? false,
  });
  if (error) throw error;
  return data as CompetitionImportResult;
}

/**
 * Ask the server to read a pasted profile link and extract W/L (Phase 2 —
 * needs the `read-competition-link` edge function + Claude key deployed).
 * Returns proposed { wins, losses } for the member to confirm.
 */
export async function readCompetitionLink(
  source: CompSource,
  url: string,
): Promise<{ found: boolean; wins: number; losses: number }> {
  const { data, error } = await supabase.functions.invoke('read-competition-link', {
    body: { source, url },
  });
  if (error) {
    throw new Error('Couldn’t read that link right now. Please try again in a bit.');
  }
  return data as { found: boolean; wins: number; losses: number };
}
