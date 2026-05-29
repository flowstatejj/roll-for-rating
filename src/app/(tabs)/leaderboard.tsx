import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchLeaderboard } from '@/lib/matches';
import type { Profile } from '@/lib/types';

export default function LeaderboardScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    try {
      setRows(await fetchLeaderboard());
    } catch (e) {
      console.warn('Failed to load leaderboard', e);
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
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        Rankings
      </ThemedText>

      {rows.length === 0 ? (
        <EmptyState icon="podium-outline" title="No grapplers yet" subtitle="Be the first to climb the ladder." />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {rows.map((p, i) => {
            const isMe = p.id === userId;
            const rank = i + 1;
            const medal = rank === 1 ? '#E5B53A' : rank === 2 ? '#A7AAB0' : rank === 3 ? '#B07A45' : null;
            return (
              <View key={p.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                  <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                    <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>
                      {rank}
                    </ThemedText>
                  </View>
                  <Avatar name={p.display_name} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                      {p.display_name}
                      {isMe ? ' (you)' : ''}
                    </ThemedText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                      <BeltChip belt={p.belt_rank} size="sm" />
                      <ThemedText type="small" themeColor="textSecondary">
                        {p.wins}W · {p.losses}L · {p.draws}D
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>{p.rating}</ThemedText>
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
