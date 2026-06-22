import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { Loading } from '@/components/ui/kit';
import { AuthProvider, useAuth } from '@/lib/auth';
import { I18nProvider, useTranslation } from '@/lib/i18n';
import { initSentry, wrapWithSentry } from '@/lib/sentry';
import { SubscriptionProvider, useSubscription } from '@/lib/subscription';

// Initialise crash/performance monitoring as early as possible (no-op until a
// EXPO_PUBLIC_SENTRY_DSN is configured).
initSentry();

// chess.com-style dark navigation chrome.
const NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.background,
    card: Colors.dark.background,
    text: Colors.dark.text,
    border: Colors.dark.border,
    primary: Colors.dark.accent,
  },
};

/**
 * Header back control. The default native back arrow only appears when there's a
 * screen beneath this one in the stack — so a detail screen opened cold from a
 * notification / share deep link (or after a router.replace) would have NO way
 * out. This always shows a chevron: it pops when possible, otherwise falls back
 * to Home so the user is never stranded.
 */
function HeaderBack() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={16}
      style={{ paddingRight: 16, paddingVertical: 4 }}
      accessibilityRole="button"
      accessibilityLabel="Back">
      <Ionicons name="chevron-back" size={28} color={Colors.dark.accent} />
    </Pressable>
  );
}

function RootNavigator() {
  const { session, initializing, onboarded } = useAuth();
  const { active, ready: subReady } = useSubscription();
  const { t } = useTranslation();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    const onPaywall = segments[0] === 'paywall';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
      return;
    }
    if (session && inAuthGroup) {
      router.replace(onboarded === false ? '/onboarding' : '/(tabs)');
      return;
    }
    if (session && onboarded === false && !inOnboarding) {
      router.replace('/onboarding');
      return;
    }
    if (session && onboarded && inOnboarding) {
      router.replace('/(tabs)');
      return;
    }
    // Hard paywall: signed in + onboarded + entitlement state known.
    if (session && onboarded && subReady) {
      if (!active && !onPaywall) {
        router.replace('/paywall');
      } else if (active && onPaywall) {
        router.replace('/(tabs)');
      }
    }
  }, [session, initializing, onboarded, active, subReady, segments, router]);

  // Hold the splash until we know auth AND (for signed-in users) entitlement,
  // so we don't flash the tabs before redirecting to the paywall.
  if (initializing) return <Loading />;
  if (session && onboarded && !subReady) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false, headerLeft: () => <HeaderBack /> }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="paywall" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="support" options={{ headerShown: true, title: t('nav.support') }} />
      <Stack.Screen
        name="match/new"
        options={{ presentation: 'modal', headerShown: true, title: t('home.newChallenge') }}
      />
      <Stack.Screen name="match/[id]" options={{ headerShown: true, title: t('nav.match') }} />
      <Stack.Screen name="gyms" options={{ headerShown: true, title: t('nav.gyms') }} />
      <Stack.Screen name="gym/[id]" options={{ headerShown: true, title: t('nav.gym') }} />
      <Stack.Screen name="user/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="avatar-builder" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="affiliate" options={{ headerShown: true, title: t('af.title') }} />
      <Stack.Screen name="find" options={{ headerShown: true, title: t('nav.findRoll') }} />
      <Stack.Screen name="open-mats" options={{ headerShown: true, title: t('nav.openMats') }} />
      <Stack.Screen name="high-rollers" options={{ headerShown: true, title: t('nav.biggestPots') }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: t('nav.matchChat') }} />
      <Stack.Screen name="watch" options={{ headerShown: true, title: t('nav.watch') }} />
      <Stack.Screen name="rivalries" options={{ headerShown: true, title: t('nav.rivalries') }} />
      <Stack.Screen name="champions" options={{ headerShown: true, title: t('nav.champions') }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, title: t('nav.notifications') }} />
      <Stack.Screen name="submission-hunt" options={{ headerShown: true, title: t('nav.submissionHunt') }} />
      <Stack.Screen name="quests" options={{ headerShown: true, title: t('nav.quests') }} />
      <Stack.Screen name="leagues" options={{ headerShown: true, title: t('nav.leagues') }} />
      <Stack.Screen name="league/[id]" options={{ headerShown: true, title: t('nav.league') }} />
      <Stack.Screen name="tournaments" options={{ headerShown: true, title: t('nav.tournaments') }} />
      <Stack.Screen name="tournament/[id]" options={{ headerShown: true, title: t('nav.tournament') }} />
      <Stack.Screen name="tournament/bout/[id]" options={{ headerShown: true, title: t('tn.record') }} />
      <Stack.Screen name="gym-rankings" options={{ headerShown: true, title: t('nav.gymRankings') }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('settings.title') }} />
      <Stack.Screen name="admin" options={{ headerShown: true, title: t('admin.title') }} />
      <Stack.Screen name="juniors" options={{ headerShown: true, title: t('profile.myJuniors') }} />
      <Stack.Screen name="invites" options={{ headerShown: true, title: t('profile.juniorChallenges') }} />
      <Stack.Screen name="friends" options={{ headerShown: true, title: t('frn.title') }} />
      <Stack.Screen name="invite" options={{ headerShown: true, title: t('inv.title') }} />
      <Stack.Screen name="elite" options={{ headerShown: true, title: t('elite.title') }} />
    </Stack>
  );
}

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={NavTheme}>
          <I18nProvider>
            <AuthProvider>
              <SubscriptionProvider>
                <RootNavigator />
                <StatusBar style="light" />
              </SubscriptionProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default wrapWithSentry(RootLayout);
