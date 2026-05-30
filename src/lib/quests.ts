import { supabase } from './supabase';
import type { Quest } from './types';

/** Bump the daily activity streak (call on app open). Returns the new streak. */
export async function pingActivity(): Promise<number> {
  const { data, error } = await supabase.rpc('ping_activity');
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function fetchQuests(): Promise<Quest[]> {
  const { data, error } = await supabase.rpc('quest_status');
  if (error) throw error;
  return (data ?? []) as Quest[];
}

export async function claimQuest(key: string): Promise<{ ok: boolean; reward?: number; new_rating?: number; reason?: string }> {
  const { data, error } = await supabase.rpc('claim_quest', { p_key: key });
  if (error) throw error;
  return data as { ok: boolean; reward?: number; new_rating?: number; reason?: string };
}
