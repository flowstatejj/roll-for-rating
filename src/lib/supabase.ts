import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type User } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaced early so a missing .env is obvious instead of a cryptic crash.
  throw new Error(
    'Missing Supabase config. Add EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file and restart the dev server.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // AsyncStorage persists the session on-device; not needed on web.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// --- Cached current user -----------------------------------------------------
// supabase.auth.getUser() makes a network round trip to the auth server on every
// call to re-validate the token. Hot paths (analytics, safety, support) only need
// the signed-in user's id/email to fill a row — and RLS enforces the real auth
// server-side from the JWT — so a locally cached session read is sufficient and
// avoids per-call load. This cache is seeded from the persisted session and kept
// in sync with sign-in / sign-out / token-refresh.
let cachedUser: User | null = null;

supabase.auth.getSession().then(({ data }) => {
  cachedUser = data.session?.user ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedUser = session?.user ?? null;
});

/**
 * The signed-in user from the cached session, or null. Reads local state only —
 * never hits the network. Prefer this over `supabase.auth.getUser()` when you
 * just need the user id/email; the auth server still verifies the JWT on the
 * actual request via RLS.
 */
export async function getCachedUser(): Promise<User | null> {
  if (cachedUser) return cachedUser;
  // Cache not warm yet (e.g. called during cold start) — read the persisted
  // session locally; still no network round trip.
  const { data } = await supabase.auth.getSession();
  cachedUser = data.session?.user ?? null;
  return cachedUser;
}
