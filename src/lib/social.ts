import { fetchMyFriends } from './friends';
import { continentForCountry } from './geo';
import { fetchBlockedIds } from './safety';
import { supabase } from './supabase';
import type { BeltRank, Gym, GymFriend, GymWithMeta, OpenMat, Profile } from './types';

// ---------------------------------------------------------------------------
// Gyms
// ---------------------------------------------------------------------------
export async function fetchGyms(query = ''): Promise<Gym[]> {
  let req = supabase.from('gyms').select('*').order('name').limit(50);
  const q = query.trim();
  if (q) req = req.or(`name.ilike.%${q}%,city.ilike.%${q}%`);
  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []) as Gym[];
}

export async function fetchGym(gymId: string, userId: string): Promise<GymWithMeta> {
  const [{ data: gym, error: gErr }, { count, error: cErr }, { data: me, error: mErr }] =
    await Promise.all([
      supabase.from('gyms').select('*').eq('id', gymId).single(),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('gym_id', gymId),
      supabase.from('profiles').select('gym_id').eq('id', userId).single(),
    ]);
  if (gErr) throw gErr;
  if (cErr) throw cErr;
  if (mErr) throw mErr;
  return {
    ...(gym as Gym),
    member_count: count ?? 0,
    is_owner: (gym as Gym).owner_id === userId,
    is_member: (me as { gym_id: string | null }).gym_id === gymId,
  };
}

/** Only the fields the gym members list renders (profiles is a wide table). */
export type GymMember = Pick<Profile, 'id' | 'display_name' | 'belt_rank' | 'rating'>;

export async function fetchGymMembers(gymId: string): Promise<GymMember[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,display_name,belt_rank,rating')
    .eq('gym_id', gymId)
    .order('rating', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GymMember[];
}

export async function createGym(
  name: string,
  city: string,
  state: string,
  country: string,
  description: string,
): Promise<Gym> {
  const { data, error } = await supabase.rpc('create_gym', {
    p_name: name,
    p_city: city,
    p_state: state,
    p_country: country,
    p_continent: continentForCountry(country) ?? '',
    p_description: description,
  });
  if (error) throw error;
  return data as Gym;
}

export async function joinGym(userId: string, gymId: string) {
  const { error } = await supabase.from('profiles').update({ gym_id: gymId }).eq('id', userId);
  if (error) throw error;
}

export async function leaveGym(userId: string) {
  const { error } = await supabase.from('profiles').update({ gym_id: null }).eq('id', userId);
  if (error) throw error;
}

/** The gym (if any) the user OWNS — needed to manage gym friendships. */
export async function fetchOwnedGymId(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('gyms').select('id').eq('owner_id', userId).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Gym friendships
// ---------------------------------------------------------------------------
export async function requestGymFriendship(targetGymId: string) {
  const { error } = await supabase.rpc('request_gym_friendship', { p_target_gym: targetGymId });
  if (error) throw error;
}

export async function respondGymFriendship(friendshipId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_gym_friendship', { p_id: friendshipId, p_accept: accept });
  if (error) throw error;
}

export async function fetchGymFriends(myGymId: string): Promise<GymFriend[]> {
  const { data: links, error } = await supabase
    .from('gym_friendships')
    .select('*')
    .or(`gym_low.eq.${myGymId},gym_high.eq.${myGymId}`);
  if (error) throw error;

  const rows = (links ?? []) as {
    id: string;
    gym_low: string;
    gym_high: string;
    requested_by_gym: string;
    status: 'pending' | 'accepted';
  }[];
  if (rows.length === 0) return [];

  const otherIds = rows.map((r) => (r.gym_low === myGymId ? r.gym_high : r.gym_low));
  const { data: gyms, error: gErr } = await supabase.from('gyms').select('*').in('id', otherIds);
  if (gErr) throw gErr;
  const gymById = new Map((gyms ?? []).map((g) => [(g as Gym).id, g as Gym]));

  return rows
    .map((r) => {
      const otherId = r.gym_low === myGymId ? r.gym_high : r.gym_low;
      const gym = gymById.get(otherId);
      if (!gym) return null;
      return {
        friendship_id: r.id,
        gym,
        status: r.status,
        incoming: r.status === 'pending' && r.requested_by_gym !== myGymId,
      } as GymFriend;
    })
    .filter(Boolean) as GymFriend[];
}

/** Members of my gym + members of gyms my gym is friends with (challenge pool). */
export async function fetchFriendlyOpponents(userId: string, myGymId: string): Promise<Profile[]> {
  const { data: links, error } = await supabase
    .from('gym_friendships')
    .select('gym_low,gym_high,status')
    .eq('status', 'accepted')
    .or(`gym_low.eq.${myGymId},gym_high.eq.${myGymId}`);
  if (error) throw error;

  const friendly = (links ?? []).map((r: { gym_low: string; gym_high: string }) =>
    r.gym_low === myGymId ? r.gym_high : r.gym_low,
  );
  const gymIds = [myGymId, ...friendly];

  const { data, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .in('gym_id', gymIds)
    .neq('id', userId)
    .order('rating', { ascending: false });
  if (pErr) throw pErr;
  return (data ?? []) as Profile[];
}

/**
 * The full "network" challenge pool: members of your gym + friendly gyms, PLUS
 * your personal friends — deduped and sorted by rating. Works without a gym too
 * (friends only), so friends are always reachable for a roll.
 */
export async function fetchNetworkOpponents(userId: string, myGymId: string | null): Promise<Profile[]> {
  const gymPool = myGymId ? await fetchFriendlyOpponents(userId, myGymId) : [];

  const friends = await fetchMyFriends();
  const friendIds = friends.map((f) => f.id).filter((id) => id !== userId);
  let friendProfiles: Profile[] = [];
  if (friendIds.length) {
    const { data, error } = await supabase.from('profiles').select('*').in('id', friendIds);
    if (error) throw error;
    friendProfiles = (data ?? []) as Profile[];
  }

  const byId = new Map<string, Profile>();
  for (const p of [...gymPool, ...friendProfiles]) {
    if (p.id !== userId) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => b.rating - a.rating);
}

// ---------------------------------------------------------------------------
// Open mats
// ---------------------------------------------------------------------------
export interface OpenMatFilters {
  query?: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export async function fetchOpenMats(filters: OpenMatFilters = {}): Promise<OpenMat[]> {
  let req = supabase.from('open_mats').select('*').order('created_at', { ascending: false }).limit(100);
  const q = (filters.query ?? '').trim();
  if (q) req = req.or(`title.ilike.%${q}%,address.ilike.%${q}%`);
  // Location filters use case-insensitive exact match (values come from the
  // region dropdowns, which are sourced from real data).
  if (filters.country) req = req.ilike('country', filters.country);
  if (filters.state) req = req.ilike('state', filters.state);
  if (filters.city) req = req.ilike('city', filters.city);
  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []) as OpenMat[];
}

/** Distinct country/state/city combos present in open mats — feeds the cascading filters. */
export async function fetchOpenMatRegions(): Promise<Pick<OpenMat, 'city' | 'state' | 'country'>[]> {
  const { data, error } = await supabase
    .from('open_mats')
    .select('city, state, country')
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Pick<OpenMat, 'city' | 'state' | 'country'>[];
}

export async function createOpenMat(args: {
  createdBy: string;
  title: string;
  city: string;
  state: string;
  country: string;
  address: string;
  schedule: string;
  notes: string;
  gymId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('open_mats').insert({
    created_by: args.createdBy,
    title: args.title.trim(),
    city: args.city.trim() || null,
    state: args.state.trim() || null,
    country: args.country.trim() || null,
    address: args.address.trim() || null,
    schedule: args.schedule.trim() || null,
    notes: args.notes.trim() || null,
    gym_id: args.gymId,
  });
  if (error) throw error;
}

export async function deleteOpenMat(id: string): Promise<void> {
  const { error } = await supabase.from('open_mats').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// "Open for a challenge" matchmaking
// ---------------------------------------------------------------------------
export async function setOpenForChallenge(userId: string, open: boolean) {
  const { error } = await supabase.from('profiles').update({ open_for_challenge: open }).eq('id', userId);
  if (error) throw error;
}

export async function fetchOpenChallengers(
  userId: string,
  filters: { city?: string; belt?: BeltRank | null; minRating?: number; maxRating?: number },
): Promise<Profile[]> {
  let req = supabase
    .from('profiles')
    .select('*')
    .eq('open_for_challenge', true)
    .neq('id', userId)
    .order('rating', { ascending: false })
    .limit(50);

  const city = filters.city?.trim();
  if (city) req = req.ilike('city', `%${city}%`);
  if (filters.belt) req = req.eq('belt_rank', filters.belt);
  if (filters.minRating != null) req = req.gte('rating', filters.minRating);
  if (filters.maxRating != null) req = req.lte('rating', filters.maxRating);

  const [{ data, error }, blocked] = await Promise.all([req, fetchBlockedIds()]);
  if (error) throw error;
  const hide = new Set(blocked);
  return (data ?? []).filter((p: Profile) => !hide.has(p.id)) as Profile[];
}
