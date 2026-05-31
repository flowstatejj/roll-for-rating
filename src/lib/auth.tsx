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

import { supabase } from './supabase';
import type { BeltRank, Profile } from './types';

const onboardKey = (uid: string) => `onboarded:${uid}`;

interface SignUpArgs {
  email: string;
  password: string;
  username: string;
  displayName: string;
  beltRank: BeltRank;
  isMinor: boolean;
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
    setProfile(data);
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
      }
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
        loadOnboarded(newSession.user.id);
      } else {
        setProfile(null);
        setOnboarded(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, loadOnboarded]);

  const markOnboarded = useCallback(async () => {
    if (session?.user) await AsyncStorage.setItem(onboardKey(session.user.id), '1');
    setOnboarded(true);
  }, [session]);

  const signUp = useCallback(
    async ({ email, password, username, displayName, beltRank, isMinor }: SignUpArgs) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Picked up by the handle_new_user() trigger to seed the profile row.
          data: {
            username: username.trim().toLowerCase(),
            display_name: displayName.trim(),
            belt_rank: beltRank,
            is_minor: isMinor,
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
