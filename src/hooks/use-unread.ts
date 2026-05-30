import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { fetchUnreadCount } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

/** Live count of unread notifications for the bell badge. */
export function useUnread(): number {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [count, setCount] = useState(0);

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

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel('unread-notifs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, load]);

  return count;
}
