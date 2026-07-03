import { supabase } from './supabase';
import { PROFILE_COLS, type BeltRank, type Profile } from './types';

/** All under-14 profiles managed by this guardian. */
export async function fetchJuniors(guardianId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('managed_by', guardianId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Profile[];
}

function juniorUsername(displayName: string): string {
  const base =
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 12) || 'jr';
  const suffix = Math.floor(Math.random() * 1_000_000).toString(36);
  return `${base}_${suffix}`;
}

/**
 * Create a parent-managed junior (under-14) profile. The DB enforces that the
 * caller is an adult, that managed_by points at them, and that the birthdate is
 * under 14; age tier / consent are set by the profiles trigger.
 */
export async function addJunior(args: {
  guardianId: string;
  displayName: string;
  beltRank: BeltRank;
  birthdate: string; // ISO YYYY-MM-DD
  gymId?: string | null;
}): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      username: juniorUsername(args.displayName),
      display_name: args.displayName.trim(),
      belt_rank: args.beltRank,
      birthdate: args.birthdate,
      managed_by: args.guardianId,
      gym_id: args.gymId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function removeJunior(juniorId: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', juniorId);
  if (error) throw error;
}
