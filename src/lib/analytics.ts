// First-party product analytics. Events land in public.analytics_events (our
// own Supabase) — no third-party tracker, so there's no cross-app tracking and
// no App Tracking Transparency prompt. Fire-and-forget: analytics must NEVER
// break or slow a user flow, so every call swallows its own errors.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getCachedUser, supabase } from './supabase';

// One id per app launch, so we can stitch a session together without any
// persistent device identifier.
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const APP_VERSION = Constants.expoConfig?.version ?? null;

/** Record a product-interaction event (e.g. 'paywall_view', 'match_created'). */
export async function track(event: string, props: Record<string, unknown> = {}): Promise<void> {
  try {
    const user = await getCachedUser();
    await supabase.from('analytics_events').insert({
      user_id: user?.id ?? null,
      event,
      props,
      session_id: SESSION_ID,
      platform: Platform.OS,
      app_version: APP_VERSION,
    });
  } catch {
    // Intentionally ignored — never surface analytics failures to the user.
  }
}
