import { supabase } from './supabase';

export interface MatchRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
  my_junior_id: string;
  my_junior_first: string;
  other_id: string;
  other_first: string;
  other_rating: number;
}

/** A guardian's kid-vs-kid challenges (both directions), first names only. */
export async function fetchMatchRequests(): Promise<MatchRequest[]> {
  const { data, error } = await supabase.rpc('my_match_requests');
  if (error) throw error;
  return (data ?? []) as MatchRequest[];
}

/** Challenge another kid on behalf of one of my juniors. */
export async function createMatchRequest(fromJuniorId: string, toJuniorId: string): Promise<void> {
  const { error } = await supabase.rpc('create_match_request', {
    p_from_junior: fromJuniorId,
    p_to_junior: toJuniorId,
  });
  if (error) throw error;
}

/** The challenged kid's guardian accepts (true) or declines (false). */
export async function respondMatchRequest(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_match_request', { p_id: id, p_accept: accept });
  if (error) throw error;
}

/** The challenger's guardian cancels a pending challenge. */
export async function cancelMatchRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_match_request', { p_id: id });
  if (error) throw error;
}
