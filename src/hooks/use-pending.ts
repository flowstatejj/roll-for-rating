import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { fetchMyMatches } from '@/lib/matches';
import { supabase } from '@/lib/supabase';

/** How many matches currently need an action from the user (respond / record). */
export function usePendingCount(): number {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    try {
      const ms = await fetchMyMatches(userId);
      setCount(
        ms.filter(
          (m) =>
            (m.status === 'pending_opponent' && m.opponent_id === userId) ||
            (m.status === 'pending_referee' && m.referee_id === userId),
        ).length,
      );
    } catch {
      /* ignore — badge is best-effort */
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    // Scope to the user's own matches (as opponent or referee — the two roles
    // that produce a pending action) rather than the entire matches table, so
    // unrelated public match changes don't wake every client.
    const ch = supabase
      .channel('pending-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `opponent_id=eq.${userId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `referee_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, load]);

  return count;
}
