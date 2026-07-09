import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { registerForPush, routeForNotification } from '@/lib/push';

/**
 * Registers this device for push once per signed-in user, and routes a tapped
 * notification (foreground, background, or cold start) to its target screen.
 * Mounted once from the root navigator.
 *
 * Cold-start taps are QUEUED until the root navigator is mounted AND a user is
 * signed in. Otherwise `router.push` fires against a navigator that isn't ready
 * yet — the root layout is still showing <Loading/> while it restores the auth
 * session — and the app opens to a black screen. (A tap while the app is already
 * running works because everything is already mounted.) This was the reported
 * friend-request "black screen on cold start" bug.
 */
export function usePush() {
  const { session } = useAuth();
  const router = useRouter();
  const navState = useRootNavigationState();
  const registeredFor = useRef<string | null>(null);

  const signedIn = !!session?.user?.id;
  const navReady = !!navState?.key; // undefined until the root navigator mounts
  // Keep the latest readiness in a ref so the once-mounted notification listeners
  // can read the current value without re-subscribing.
  const readyRef = useRef(false);
  readyRef.current = navReady && signedIn;
  const pendingRoute = useRef<string | null>(null);

  // Register this device when a user signs in (once per user id).
  useEffect(() => {
    const uid = session?.user?.id ?? null;
    if (uid && registeredFor.current !== uid) {
      registeredFor.current = uid;
      registerForPush();
    } else if (!uid) {
      registeredFor.current = null;
    }
  }, [session?.user?.id]);

  // Navigate to a queued route once the app is ready; no-op if nothing is queued.
  const flush = useCallback(() => {
    if (readyRef.current && pendingRoute.current) {
      const route = pendingRoute.current;
      pendingRoute.current = null;
      router.push(route as never);
    }
  }, [router]);

  // Resolve a tapped notification to a route, then navigate now (if ready) or
  // queue it until the navigator + auth become ready.
  const handle = useCallback(
    (data: unknown) => {
      const route = routeForNotification(data as Parameters<typeof routeForNotification>[0]);
      if (!route) return;
      pendingRoute.current = route;
      flush();
    },
    [flush],
  );

  // Subscribe to live taps + read the launching (cold-start) notification. Runs
  // once — `handle` only changes if `router` changes, which it doesn't.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      handle(resp.notification.request.content.data);
    });
    // Cold start: app opened by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handle(resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, [handle]);

  // Flush a queued cold-start route as soon as the navigator is mounted and the
  // user is signed in.
  useEffect(() => {
    flush();
  }, [navReady, signedIn, flush]);
}
