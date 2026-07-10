// Device push registration + tap routing. Pairs with the `send-push` edge
// function: we store this device's Expo push token server-side, and resolve a
// tapped notification's data payload to an in-app route.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// Foreground behavior: show a banner + sound; leave the app icon badge alone
// (the in-app bell already tracks unread).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const PROJECT_ID =
  (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)?.extra?.eas?.projectId ??
  (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId;

/**
 * Register this device for push: ensure permission, fetch the Expo push token,
 * and store it against the signed-in user. No-op on web / simulator / when
 * permission is denied. Safe to call on every launch.
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted' || !PROJECT_ID) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    if (token) await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  } catch (e) {
    console.warn('push registration failed', e);
  }
}

type TapData = {
  type?: string;
  match_id?: string | null;
  lid?: string | null;
  tid?: string | null;
  fid?: string | null;
};

/** Resolve a tapped notification's data payload to an in-app route. */
export function routeForNotification(data: TapData | null | undefined): string | null {
  if (!data) return null;
  if (data.match_id) return `/match/${data.match_id}`;
  if (data.type === 'tournament_invite' && data.tid) return `/tournament/${data.tid}`;
  if ((data.type === 'league_invite' || data.type === 'league_matchup' || data.type === 'league_message') && data.lid)
    return `/league/${data.lid}`;
  if (data.type === 'friend_accepted' && data.fid) return `/user/${data.fid}`;
  if (data.type === 'friend_request') return '/friends';
  if (data.type === 'gym_request') return '/(tabs)/community';
  if (data.type === 'affiliate') return '/affiliate';
  return '/notifications';
}
