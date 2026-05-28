import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { MatchCard } from '@/components/match-card';
import { ThemedText } from '@/components/themed-text';
import { BeltChip, Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchMyMatches } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import type { MatchWithPeople } from '@/lib/types';

export default function HomeScreen() {
  const { profile, refreshProfile, session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await fetchMyMatches(userId);
      setMatches(data);
    } catch (e) {
      console.warn('Failed to load matches', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Reload whenever the tab gains focus.
  useFocusEffect(
    useCallback(() => {
      load();
      refreshProfile();
    }, [load, refreshProfile]),
  );

  // Live updates: any change to a match row refreshes the list + my rating.
  useEffect(() => {
    const channel = supabase
      .channel('home-matches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        load();
        refreshProfile();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, refreshProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshProfile()]);
    setRefreshing(false);
  }, [load, refreshProfile]);

  if (loading || !profile) return <Loading />;

  const needsMe = matches.filter(
    (m) =>
      (m.status === 'pending_opponent' && m.opponent_id === userId) ||
      (m.status === 'pending_referee' && m.referee_id === userId),
  );
  const recent = matches.slice(0, 5);

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View style={styles.greetRow}>
        <View>
          <ThemedText themeColor="textSecondary">Welcome back,</ThemedText>
          <ThemedText type="subtitle" style={{ fontSize: 26 }}>
            {profile.display_name}
          </ThemedText>
        </View>
        <BeltChip belt={profile.belt_rank} />
      </View>

      {/* Rating card */}
      <Card style={{ backgroundColor: theme.accent }}>
        <ThemedText style={{ color: theme.accentText, opacity: 0.85, fontWeight: '700' }}>
          RATING
        </ThemedText>
        <ThemedText style={{ color: theme.accentText, fontSize: 56, fontWeight: '800', lineHeight: 60 }}>
          {profile.rating}
        </ThemedText>
        <View style={styles.record}>
          <Stat label="Wins" value={profile.wins} tint={theme.accentText} />
          <Stat label="Losses" value={profile.losses} tint={theme.accentText} />
          <Stat label="Draws" value={profile.draws} tint={theme.accentText} />
        </View>
      </Card>

      <Button label="New Challenge" icon="add-circle" onPress={() => router.push('/match/new')} />

      {needsMe.length > 0 && (
        <View style={styles.section}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Needs your attention
          </ThemedText>
          {needsMe.map((m) => (
            <MatchCard key={m.id} match={m} currentUserId={userId!} />
          ))}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Recent matches
          </ThemedText>
          {matches.length > 5 && (
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} onPress={() => router.push('/(tabs)/matches')} />
          )}
        </View>
        {recent.length === 0 ? (
          <EmptyState
            icon="hand-left-outline"
            title="No matches yet"
            subtitle="Start a challenge at the next open mat to get on the board."
          />
        ) : (
          recent.map((m) => <MatchCard key={m.id} match={m} currentUserId={userId!} />)
        )}
      </View>
    </Screen>
  );
}

function Stat({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <ThemedText style={{ color: tint, fontSize: 22, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText style={{ color: tint, opacity: 0.85, fontSize: 13 }}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  greetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  record: { flexDirection: 'row', marginTop: Spacing.three },
  section: { gap: Spacing.three },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 20 },
});
