import { supabase } from './supabase';
import { BELT_LABELS, PROFILE_COLS, type Profile } from './types';

export interface Champion {
  key: string;
  title: string;
  champ: Profile | null;
  isMe: boolean;
}

async function topRated(apply: (q: any) => any): Promise<Profile | null> {
  const { data, error } = await apply(
    supabase.from('profiles').select(PROFILE_COLS).order('rating', { ascending: false }).limit(1),
  );
  if (error) throw error;
  return ((data ?? [])[0] as Profile) ?? null;
}

/**
 * King-of-the-Hill titles, derived from who currently sits #1 in each scope:
 * your belt division (global), your gym, and your city.
 */
export async function fetchChampions(profile: Profile): Promise<Champion[]> {
  // The three scopes are independent — run them in parallel instead of a
  // sequential waterfall (this fires on every profile-screen focus).
  const [div, gym, city] = await Promise.all([
    topRated((q) => q.eq('belt_rank', profile.belt_rank)),
    profile.gym_id ? topRated((q) => q.eq('gym_id', profile.gym_id)) : Promise.resolve(null),
    profile.city ? topRated((q) => q.ilike('city', profile.city as string)) : Promise.resolve(null),
  ]);

  const out: Champion[] = [];
  out.push({
    key: 'division',
    title: `${BELT_LABELS[profile.belt_rank]} Belt Champion`,
    champ: div,
    isMe: div?.id === profile.id,
  });
  if (profile.gym_id) {
    out.push({ key: 'gym', title: 'Gym Champion', champ: gym, isMe: gym?.id === profile.id });
  }
  if (profile.city) {
    out.push({ key: 'city', title: `${profile.city} Champion`, champ: city, isMe: city?.id === profile.id });
  }

  return out;
}

export function heldTitles(champs: Champion[]): string[] {
  return champs.filter((c) => c.isMe && c.champ).map((c) => c.title);
}
