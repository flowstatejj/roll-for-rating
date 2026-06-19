import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';

import { PENDING_REFERRAL_KEY, redeemReferralCode } from './referrals';
import { supabase } from './supabase';
import type { BeltRank, Profile } from './types';

const onboardKey = (uid: string) => `onboarded:${uid}`;

interface SignUpArgs {
  email: string;
  password: string;
  username: string;
  displayName: string;
  beltRank: BeltRank;
  /** ISO date 'YYYY-MM-DD'. Tier (adult/teen/kid) is computed server-side. */
  birthdate: string;
  /** Required for minors — the parent/guardian who must approve the account. */
  parentEmail: string | null;
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  /** true until we've checked for an existing session on launch */
  initializing: boolean;
  /** null while unknown; false = should see onboarding */
  onboarded: boolean | null;
  markOnboarded: () => Promise<void>;
  signUp: (args: SignUpArgs) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  const loadOnboarded = useCallback(async (userId: string) => {
    try {
      const v = await AsyncStorage.getItem(onboardKey(userId));
      setOnboarded(v === '1');
    } catch {
      setOnboarded(true); // fail open — don't trap users
    }
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      console.warn('Failed to load profile:', error.message);
      setProfile(null);
      return;
    }
    // App Store 1.2: a banned (ejected) member is signed out on load.
    if (data?.banned) {
      setProfile(null);
      await supabase.auth.signOut();
      Alert.alert(
        'Account suspended',
        'Your account has been suspended for violating our community guidelines.',
      );
      return;
    }
    setProfile(data);
  }, []);

  // If a referral code was captured at signup, attach it once a session exists.
  // Cleared on a definitive outcome; a bare network failure is retried next session.
  const redeemPendingReferral = useCallback(async () => {
    try {
      const code = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
      if (!code) return;
      const res = await redeemReferralCode(code);
      if (res.ok || res.reason) await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
    } catch {
      /* best-effort */
    }
  }, []);

  // On launch: restore any saved session, then subscribe to auth changes.
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user.id);
        loadOnboarded(data.session.user.id);
        redeemPendingReferral();
      }
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
        loadOnboarded(newSession.user.id);
        redeemPendingReferral();
      } else {
        setProfile(null);
        setOnboarded(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, loadOnboarded, redeemPendingReferral]);

  const markOnboarded = useCallback(async () => {
    if (session?.user) await AsyncStorage.setItem(onboardKey(session.user.id), '1');
    setOnboarded(true);
  }, [session]);

  const signUp = useCallback(
    async ({ email, password, username, displayName, beltRank, birthdate, parentEmail }: SignUpArgs) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Picked up by the handle_new_user() trigger to seed the profile row.
          data: {
            username: username.trim().toLowerCase(),
            display_name: displayName.trim(),
            belt_rank: beltRank,
            birthdate,
            parent_email: parentEmail ?? '',
          },
        },
      });
      if (error) throw error;
    },
    [],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo(
    () => ({ session, profile, initializing, onboarded, markOnboarded, signUp, signIn, signOut, refreshProfile }),
    [session, profile, initializing, onboarded, markOnboarded, signUp, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
