import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { Loading } from '@/components/ui/kit';
import { AuthProvider, useAuth } from '@/lib/auth';

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
        options={{ presentation: 'modal', headerShown: true, title: 'New Challenge' }}
      />
      <Stack.Screen name="match/[id]" options={{ headerShown: true, title: 'Match' }} />
      <Stack.Screen name="puzzle/solve" options={{ headerShown: true, title: 'Puzzle' }} />
      <Stack.Screen name="competitions" options={{ headerShown: true, title: 'Competition Record' }} />
      <Stack.Screen name="gyms" options={{ headerShown: true, title: 'Gyms' }} />
      <Stack.Screen name="gym/[id]" options={{ headerShown: true, title: 'Gym' }} />
      <Stack.Screen name="find" options={{ headerShown: true, title: 'Find a Roll' }} />
      <Stack.Screen name="open-mats" options={{ headerShown: true, title: 'Open Mats' }} />
      <Stack.Screen name="high-rollers" options={{ headerShown: true, title: 'Biggest Pots' }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: 'Match chat' }} />
      <Stack.Screen name="watch" options={{ headerShown: true, title: 'Watch' }} />
      <Stack.Screen name="rivalries" options={{ headerShown: true, title: 'Rivalries' }} />
      <Stack.Screen name="champions" options={{ headerShown: true, title: 'Champions' }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Notifications' }} />
      <Stack.Screen name="submission-hunt" options={{ headerShown: true, title: 'Submission Hunt' }} />
      <Stack.Screen name="quests" options={{ headerShown: true, title: 'Quests' }} />
      <Stack.Screen name="seasons" options={{ headerShown: true, title: 'Seasons' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={NavTheme}>
          <AuthProvider>
            <RootNavigator />
            <StatusBar style="light" />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
