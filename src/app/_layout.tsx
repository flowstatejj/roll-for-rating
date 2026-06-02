import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { Loading } from '@/components/ui/kit';
import { AuthProvider, useAuth } from '@/lib/auth';
import { I18nProvider, useTranslation } from '@/lib/i18n';

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

function RootNavigator() {
  const { session, initializing, onboarded } = useAuth();
  const { t } = useTranslation();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === 'onboarding';
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup) {
      router.replace(onboarded === false ? '/onboarding' : '/(tabs)');
    } else if (session && onboarded === false && !inOnboarding) {
      router.replace('/onboarding');
    } else if (session && onboarded && inOnboarding) {
      router.replace('/(tabs)');
    }
  }, [session, initializing, onboarded, segments, router]);

  if (initializing) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen
        name="match/new"
        options={{ presentation: 'modal', headerShown: true, title: t('home.newChallenge') }}
      />
      <Stack.Screen name="match/[id]" options={{ headerShown: true, title: t('nav.match') }} />
      <Stack.Screen name="puzzle/solve" options={{ headerShown: true, title: t('nav.puzzle') }} />
      <Stack.Screen name="competitions" options={{ headerShown: true, title: t('nav.competitionRecord') }} />
      <Stack.Screen name="gyms" options={{ headerShown: true, title: t('nav.gyms') }} />
      <Stack.Screen name="gym/[id]" options={{ headerShown: true, title: t('nav.gym') }} />
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
      <Stack.Screen name="seasons" options={{ headerShown: true, title: t('nav.seasons') }} />
      <Stack.Screen name="tournaments" options={{ headerShown: true, title: t('nav.tournaments') }} />
      <Stack.Screen name="tournament/[id]" options={{ headerShown: true, title: t('nav.tournament') }} />
      <Stack.Screen name="gym-rankings" options={{ headerShown: true, title: t('nav.gymRankings') }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('settings.title') }} />
      <Stack.Screen name="juniors" options={{ headerShown: true, title: t('profile.myJuniors') }} />
      <Stack.Screen name="invites" options={{ headerShown: true, title: t('profile.juniorChallenges') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={NavTheme}>
          <I18nProvider>
            <AuthProvider>
              <RootNavigator />
              <StatusBar style="light" />
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
