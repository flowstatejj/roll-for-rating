import { getCachedUser, supabase } from './supabase';

/** Block a user — hides them from you and prevents any matches between you. */
export async function blockUser(blockedId: string): Promise<void> {
  const me = (await getCachedUser())?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase.from('blocked_users').insert({ blocker_id: me, blocked_id: blockedId });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}

export async function unblockUser(blockedId: string): Promise<void> {
  const me = (await getCachedUser())?.id;
  if (!me) throw new Error('Not signed in');
  const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', me).eq('blocked_id', blockedId);
  if (error) throw error;
}

/** Whether the current user has blocked `otherId`. */
export async function amIBlocking(otherId: string): Promise<boolean> {
  const me = (await getCachedUser())?.id;
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
  const me = (await getCachedUser())?.id;
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

// --- Admin moderation queue (App Store 1.2: act on reports within 24h) -------
export interface UserReport {
  id: string;
  created_at: string;
  reason: string;
  details: string | null;
  reporter_name: string | null;
  reported_id: string | null;
  reported_name: string | null;
  reported_banned: boolean;
  match_id: string | null;
  video_count: number;
}

/** Admin: open moderation reports (filed by users or auto-filed on a block). */
export async function fetchUserReports(): Promise<UserReport[]> {
  const { data, error } = await supabase.rpc('admin_user_reports');
  if (error) throw error;
  return (data ?? []) as UserReport[];
}

/** Admin: act on a report — dismiss, remove the content, or ban the user. */
export async function resolveUserReport(
  reportId: string,
  action: 'dismiss' | 'remove' | 'ban',
): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_user_report', { p_report_id: reportId, p_action: action });
  if (error) throw error;
}
