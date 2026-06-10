import { supabase } from './supabase';

/** Block a user — hides them from you and prevents any matches between you. */
export async function blockUser(blockedId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase.from('blocked_users').insert({ blocker_id: me, blocked_id: blockedId });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}

export async function unblockUser(blockedId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', me).eq('blocked_id', blockedId);
  if (error) throw error;
}

/** Whether the current user has blocked `otherId`. */
export async function amIBlocking(otherId: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) return false;
  const { data } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', me)
    .eq('blocked_id', otherId)
    .maybeSingle();
  return !!data;
}

/** Ids the user has blocked or who blocked them — filter these out of lists. */
export async function fetchBlockedIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('my_blocked_ids');
  if (error) return [];
  return (data ?? []) as string[];
}

/** File a report about a user (and optionally a specific match) for moderation. */
export async function reportUser(args: {
  reportedUserId: string;
  reason: string;
  details?: string;
  matchId?: string | null;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase.from('user_reports').insert({
    reporter_id: me,
    reported_user_id: args.reportedUserId,
    match_id: args.matchId ?? null,
    reason: args.reason,
    details: args.details ?? null,
  });
  if (error) throw error;
}
