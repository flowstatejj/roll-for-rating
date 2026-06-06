import { supabase } from './supabase';
import type { Profile } from './types';

/** Fetch a single public profile by id (null if not found / not permitted). */
export async function fetchProfileById(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  if (error) return null;
  return data as Profile;
}
