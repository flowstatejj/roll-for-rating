import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { registerForPush, routeForNotification } from '@/lib/push';

/**
 * Registers this device for push once per signed-in user, and routes a tapped
 * notification (foreground, background, or cold start) to its target screen.
 * Mounted once from the root navigator.
 */
export function usePush() {
  const { session } = useAuth();
  const router = useRouter();
  const registeredFor = useRef<string | null>(null);

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

  // Route notification taps.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const go = (data: unknown) => {
      const route = routeForNotification(data as Parameters<typeof routeForNotification>[0]);
      if (route) router.push(route as never);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      go(resp.notification.request.content.data);
    });
    // Cold start: app opened by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) go(resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router]);
}
