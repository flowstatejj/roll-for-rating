import { supabase } from './supabase';

// The 8 user-facing push categories (must match public.notif_category in SQL
// and categoryFor in the send-push edge function).
export const NOTIF_CATEGORIES = [
  'challenges',
  'results',
  'messages',
  'videos',
  'reactions',
  'friends',
  'leagues',
  'gym',
] as const;
export type NotifCategory = (typeof NOTIF_CATEGORIES)[number];

/** Persist one category toggle into the caller's profiles.notif_prefs jsonb. */
export async function setNotifPref(
  userId: string,
  current: Record<string, boolean> | null,
  category: NotifCategory,
  enabled: boolean,
): Promise<void> {
  const next = { ...(current ?? {}), [category]: enabled };
  const { error } = await supabase.from('profiles').update({ notif_prefs: next }).eq('id', userId);
  if (error) throw error;
}
