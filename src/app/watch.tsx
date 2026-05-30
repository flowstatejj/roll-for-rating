import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { MatchCard } from '@/components/match-card';
import { ThemedText } from '@/components/themed-text';
import { EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchPublicMatches } from '@/lib/matches';
import type { MatchWithPeople } from '@/lib/types';

export default function WatchScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const userId = session!.user.id;
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setMatches(await fetchPublicMatches());
    } catch (e) {
      console.warn('watch load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return <Loading />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}>
      <Stack.Screen options={{ title: 'Watch' }} />
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        Watch
      </ThemedText>
      <ThemedText themeColor="textSecondary">Public matches. Tap to watch, count a view, and react.</ThemedText>

      {matches.length === 0 ? (
        <EmptyState
          icon="play-circle-outline"
          title="Nothing public yet"
          subtitle="Matches set to public by both fighters show up here once recorded."
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} currentUserId={userId} />
          ))}
        </View>
      )}
    </Screen>
  );
}
