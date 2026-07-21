import AsyncStorage from '@react-native-async-storage/async-storage';

import { Sentry, sentryEnabled } from './sentry';

// Uncaught JS errors in effects, event handlers, timers, and async callbacks do
// NOT reach a React error boundary - they hit the RN global handler and, in a
// production build, take the whole app down with no visible trace. This records
// the last such error so it can be shown on the next launch (and reported to
// Sentry), turning an invisible "the app just closed" into an actual message.

const LAST_CRASH_KEY = 'ror.lastUncaughtError';

interface ErrorUtilsLike {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (h: (error: unknown, isFatal?: boolean) => void) => void;
}

export function installCrashSurface(): void {
  const EU = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!EU?.setGlobalHandler || !EU.getGlobalHandler) return;
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((error, isFatal) => {
    try {
      const e = error as { name?: string; message?: string; stack?: string } | undefined;
      const summary = `${e?.name ?? 'Error'}: ${e?.message ?? String(error)}\n\n${(e?.stack ?? '').slice(0, 1500)}`;
      // Fire-and-forget; the app may be about to die on a fatal error.
      AsyncStorage.setItem(LAST_CRASH_KEY, summary).catch(() => {});
      if (sentryEnabled) Sentry.captureException(error);
    } catch {
      /* never let the reporter itself throw */
    }
    prev?.(error, isFatal);
  });
}

/** Reads and clears the last uncaught-error summary, if any (shown on launch). */
export async function takeLastCrash(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(LAST_CRASH_KEY);
    if (v) await AsyncStorage.removeItem(LAST_CRASH_KEY);
    return v;
  } catch {
    return null;
  }
}
