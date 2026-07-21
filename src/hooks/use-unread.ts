import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { fetchUnreadCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

// The bell lives on several screens at once (home stays mounted under the pushed
// Notifications screen), so two useUnread instances would otherwise open two
// realtime channels with the SAME topic simultaneously - a collision. Give each
// instance its own topic so they never clash.
let unreadChannelSeq = 0;

/** Live count of unread notifications for the bell badge. */
export function useUnread(): number {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [count, setCount] = useState(0);
  const channelName = useRef<string | null>(null);
  if (channelName.current === null) channelName.current = `unread-notifs-${(unreadChannelSeq += 1)}`;

  const load = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    try {
      setCount(await fetchUnreadCount(userId));
    } catch {
      /* best-effort */
    }
  }, [userId]);

  // Refetch whenever the host screen regains focus — e.g. returning from the
  // Notifications screen after they were marked read — so the badge clears even
  // when the realtime UPDATE doesn't fire.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(channelName.current!)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, load]);

  return count;
}
