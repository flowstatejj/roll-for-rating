import { supabase } from './supabase';

// A friend (or pending requester) with the profile fields the UI shows.
export interface FriendProfile {
  id: string;
  username: string;
  display_name: string;
  belt_rank: string;
  rating: number;
  avatar_warrior: string | null;
  avatar_color: string | null;
  avatar_path: string | null;
}

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';

/** Send a friend request. Returns 'requested' or 'accepted' (if they'd already asked you). */
export async function sendFriendRequest(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_friend_request', { p_user: userId });
  if (error) throw error;
  return (data ?? 'requested') as string;
}

/** Accept or decline a request someone sent you. */
export async function respondFriendRequest(requesterId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_friend_request', { p_requester: requesterId, p_accept: accept });
  if (error) throw error;
}

/** Remove a friend, or cancel a request you sent. */
export async function removeFriend(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_friend', { p_user: userId });
  if (error) throw error;
}

/** The signed-in user's accepted friends. */
export async function fetchMyFriends(): Promise<FriendProfile[]> {
  const { data, error } = await supabase.rpc('my_friends');
  if (error) throw error;
  return (data ?? []) as FriendProfile[];
}

/** Incoming pending friend requests. */
export async function fetchMyFriendRequests(): Promise<FriendProfile[]> {
  const { data, error } = await supabase.rpc('my_friend_requests');
  if (error) throw error;
  return (data ?? []) as FriendProfile[];
}

/** Relationship between the signed-in user and another user. */
export async function fetchFriendshipStatus(userId: string): Promise<FriendStatus> {
  const { data, error } = await supabase.rpc('friendship_status', { p_user: userId });
  if (error) return 'none';
  return (data ?? 'none') as FriendStatus;
}
