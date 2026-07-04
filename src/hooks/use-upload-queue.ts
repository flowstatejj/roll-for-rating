import { useEffect } from 'react';
import { AppState } from 'react-native';

import { processQueue } from '@/lib/video-queue';

/**
 * Flush any queued (offline) match-video uploads on mount and whenever the app
 * returns to the foreground - so a clip recorded with no service at the gym
 * uploads by itself once the phone is back online. Best-effort and de-duped so
 * overlapping foreground events don't double-run.
 */
export function useUploadQueue() {
  useEffect(() => {
    let running = false;
    const run = () => {
      if (running) return;
      running = true;
      processQueue().finally(() => {
        running = false;
      });
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, []);
}
