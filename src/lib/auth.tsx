import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';

import { PENDING_ELITE_INVITE_KEY, applyInviteOrReferralCode, redeemEliteInviteCode } from './elite';
import { useTranslation } from './i18n';
import { PENDING_REFERRAL_KEY, redeemReferralCode } from './referrals';
import { supabase } from './supabase';
import type { BeltRank, Profile } from './types';

const onboardKey = (uid: string) => `onboarded:${uid}`;
/** Last email a user signed in / up with; pre-filled on the auth screens. */
export const LAST_EMAIL_KEY = 'ror.lastEmail';

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
  /** False for a guardian account (manages children, does not compete). Defaults true. */
  participating?: boolean;
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
  // t via a ref so the launch effect's deps don't churn on language change.
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  // Serialises the overlapping getSession/onAuthStateChange launch paths so the
  // pending referral is redeemed (and its outcome alerted) exactly once.
  const redeemingReferral = useRef(false);

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
      // Only blank the profile when the row is genuinely gone (PGRST116). A
      // transient transport error must not wipe a good profile - that blanks
      // authenticated screens and reads as a surprise sign-out. Keep the last
      // known profile; the next load (or a realtime refresh) recovers it.
      if (error.code === 'PGRST116') setProfile(null);
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
  // Cleared on a definitive outcome; a bare network failure is retried next
  // session (silently). Definitive outcomes are surfaced once: removing the key
  // first means no later run can re-alert. 'already' also stays silent - there
  // is nothing for the user to do about it.
  const redeemPendingReferral = useCallback(async () => {
    if (redeemingReferral.current) return;
    redeemingReferral.current = true;
    try {
      const code = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
      if (!code) return;
      // The sign-up field is the only typed entry point on a store install, so
      // people paste ELITE codes into it too - try both kinds, exactly like the
      // in-app code entry. Transport failures keep the key for a retry next
      // launch; only definitive outcomes clear it.
      const res = await applyInviteOrReferralCode(code);
      if (res.kind !== 'error') await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
      if (res.kind === 'referral') {
        Alert.alert(tRef.current('code.referralOk').replace('{name}', res.name ?? code));
      } else if (res.kind === 'elite') {
        Alert.alert(tRef.current('code.eliteOk'));
      } else if (res.kind === 'invalid') {
        Alert.alert(tRef.current('code.pendingInvalid'));
      }
    } catch {
      /* best-effort */
    } finally {
      redeemingReferral.current = false;
    }
  }, []);

  // If an elite invite code was captured at signup, redeem it once a session
  // exists (grants the new member elite access). Cleared on a definitive outcome.
  const redeemPendingEliteInvite = useCallback(async () => {
    try {
      const code = await AsyncStorage.getItem(PENDING_ELITE_INVITE_KEY);
      if (!code) return;
      const res = await redeemEliteInviteCode(code);
      if (res.ok || res.reason) await AsyncStorage.removeItem(PENDING_ELITE_INVITE_KEY);
    } catch {
      /* best-effort */
    }
  }, []);

  // On launch: restore any saved session, then subscribe to auth changes.
  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) {
          await loadProfile(data.session.user.id);
          loadOnboarded(data.session.user.id);
          redeemPendingReferral();
          redeemPendingEliteInvite();
        }
      })
      .catch((e) => {
        // A storage read failure must not strand the app on the launch spinner;
        // degrade to the sign-in screen instead of hanging forever.
        console.warn('Session restore failed:', e);
      })
      .finally(() => {
        if (active) setInitializing(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
        loadOnboarded(newSession.user.id);
        redeemPendingReferral();
        redeemPendingEliteInvite();
      } else {
        setProfile(null);
        setOnboarded(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, loadOnboarded, redeemPendingReferral, redeemPendingEliteInvite]);

  const markOnboarded = useCallback(async () => {
    if (session?.user) await AsyncStorage.setItem(onboardKey(session.user.id), '1');
    setOnboarded(true);
  }, [session]);

  const signUp = useCallback(
    async ({ email, password, username, displayName, beltRank, birthdate, parentEmail, participating = true }: SignUpArgs) => {
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
            participating,
          },
        },
      });
      if (error) throw error;
      AsyncStorage.setItem(LAST_EMAIL_KEY, email.trim()).catch(() => {});
    },
    [],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Remember the email so re-login is one field (pre-filled on the auth screens).
    AsyncStorage.setItem(LAST_EMAIL_KEY, email.trim()).catch(() => {});
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
