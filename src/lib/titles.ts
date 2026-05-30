import { supabase } from './supabase';
import { BELT_LABELS, type Profile } from './types';

export interface Champion {
  key: string;
  title: string;
  champ: Profile | null;
  isMe: boolean;
}

async function topRated(apply: (q: any) => any): Promise<Profile | null> {
  const { data, error } = await apply(
    supabase.from('profiles').select('*').order('rating', { ascending: false }).limit(1),
  );
  if (error) throw error;
  return ((data ?? [])[0] as Profile) ?? null;
}

/**
 * King-of-the-Hill titles, derived from who currently sits #1 in each scope:
 * your belt division (global), your gym, and your city.
 */
export async function fetchChampions(profile: Profile): Promise<Champion[]> {
  const out: Champion[] = [];

  const div = await topRated((q) => q.eq('belt_rank', profile.belt_rank));
  out.push({
    key: 'division',
    title: `${BELT_LABELS[profile.belt_rank]} Belt Champion`,
    champ: div,
    isMe: div?.id === profile.id,
  });

  if (profile.gym_id) {
    const gym = await topRated((q) => q.eq('gym_id', profile.gym_id));
    out.push({ key: 'gym', title: 'Gym Champion', champ: gym, isMe: gym?.id === profile.id });
  }

  if (profile.city) {
    const city = await topRated((q) => q.ilike('city', profile.city as string));
    out.push({ key: 'city', title: `${profile.city} Champion`, champ: city, isMe: city?.id === profile.id });
  }

  return out;
}

export function heldTitles(champs: Champion[]): string[] {
  return champs.filter((c) => c.isMe && c.champ).map((c) => c.title);
}
