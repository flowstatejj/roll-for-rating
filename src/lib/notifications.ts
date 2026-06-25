import { supabase } from './supabase';
import type { AppNotification } from './types';

// Maps a structured render-kind (NotificationData.k) to its title + body keys.
const KIND_KEYS: Record<string, { title: string; body: string }> = {
  'challenge.new': { title: 'notif.tNew', body: 'notif.bNew' },
  'referee.new': { title: 'notif.tRefNew', body: 'notif.bRefNew' },
  'challenge.accepted': { title: 'notif.tAccepted', body: 'notif.bAccepted' },
  'referee.ready': { title: 'notif.tReady', body: 'notif.bReady' },
  'challenge.declined': { title: 'notif.tDeclined', body: 'notif.bDeclined' },
  'match.cancelled': { title: 'notif.tCancelled', body: 'notif.bCancelled' },
  'result.draw': { title: 'notif.tResult', body: 'notif.bDraw' },
  'result.win': { title: 'notif.tResult', body: 'notif.bWin' },
  'result.loss': { title: 'notif.tResult', body: 'notif.bLoss' },
  'gym.request': { title: 'notif.tGym', body: 'notif.bGym' },
  'reaction.new': { title: 'notif.tReaction', body: 'notif.bReaction' },
  'message.new': { title: 'notif.tMessage', body: 'notif.bMessage' },
  'video.new': { title: 'notif.tVideo', body: 'notif.bVideo' },
  'league.matchup': { title: 'notif.tLgMatchup', body: 'notif.bLgMatchup' },
  'league.message': { title: 'notif.tLgMessage', body: 'notif.bLgMessage' },
  'tournament.invite': { title: 'notif.tTnInvite', body: 'notif.bTnInvite' },
  'league.invite': { title: 'notif.tLgInvite', body: 'notif.bLgInvite' },
  'friend.request': { title: 'notif.tFriendReq', body: 'notif.bFriendReq' },
  'friend.accepted': { title: 'notif.tFriendAcc', body: 'notif.bFriendAcc' },
  'match.disputed': { title: 'notif.tDisputed', body: 'notif.bDisputed' },
};

/**
 * Renders a notification's title + body in the member's current language.
 * Falls back to the English `title`/`body` the trigger stored when the row has
 * no structured `data` (pre-i18n rows) or an unrecognized kind.
 */
export function localizeNotification(
  n: AppNotification,
  t: (k: string) => string,
): { title: string; body: string | null } {
  const d = n.data;
  if (!d || !KIND_KEYS[d.k]) return { title: n.title, body: n.body };
  const { title: titleKey, body: bodyKey } = KIND_KEYS[d.k];
  const fill = (s: string) =>
    s
      .replace('{name}', d.name ?? '')
      .replace('{c}', d.c ?? '')
      .replace('{o}', d.o ?? '')
      .replace('{rb}', String(d.rb ?? ''))
      .replace('{ra}', String(d.ra ?? ''))
      .replace('{emoji}', d.emoji ?? '')
      .replace('{snippet}', d.snippet ?? '')
      .replace('{gym}', d.gym ?? '');
  return { title: t(titleKey), body: fill(t(bodyKey)) };
}

export async function fetchNotifications(userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function fetchUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw error;
  return count ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw error;
}

/** Mark a specific set of notifications read (used when a tab is viewed). */
export async function markRead(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .in('id', ids);
  if (error) throw error;
}
