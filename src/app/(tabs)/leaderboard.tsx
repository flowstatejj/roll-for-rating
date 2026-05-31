import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchJuniors } from '@/lib/juniors';
import { fetchKidsLeaderboard, fetchLeaderboard, type KidsLeaderRow } from '@/lib/matches';
import type { Profile } from '@/lib/types';

type Tab = 'overall' | 'kids';

export default function LeaderboardScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('overall');
  const [rows, setRows] = useState<Profile[]>([]);
  const [kids, setKids] = useState<KidsLeaderRow[]>([]);
  const [hasJuniors, setHasJuniors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user.id;

  // The 13-&-under board is only for minors + adults who manage a junior.
  const canSeeKids = !!profile?.is_minor || hasJuniors;

  const load = useCallback(async () => {
    try {
      const [overall, kidsRows, juniors] = await Promise.all([
        fetchLeaderboard(),
        fetchKidsLeaderboard(),
        userId ? fetchJuniors(userId).catch(() => []) : Promise.resolve([]),
      ]);
      setRows(overall);
      setKids(kidsRows);
      setHasJuniors(juniors.length > 0);
    } catch (e) {
      console.warn('Failed to load leaderboard', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

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

      {canSeeKids && (
        <View style={styles.segment}>
          <Seg label="Overall" active={tab === 'overall'} onPress={() => setTab('overall')} />
          <Seg label="13 & under" active={tab === 'kids'} onPress={() => setTab('kids')} />
        </View>
      )}

      {tab === 'overall' || !canSeeKids ? (
        rows.length === 0 ? (
          <EmptyState icon="podium-outline" title="No grapplers yet" subtitle="Be the first to climb the ladder." />
        ) : (
          <Card style={styles.list}>
            {rows.map((p, i) => {
              const isMe = p.id === userId;
              const rank = i + 1;
              return (
                <View key={p.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                    <RankBadge rank={rank} />
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
        )
      ) : kids.length === 0 ? (
        <EmptyState icon="happy-outline" title="No ranked juniors yet" subtitle="Under-14 members appear here once they've competed." />
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Under-14 athletes, ranked by rating. For their privacy, only a first name is shown.
          </ThemedText>
          <Card style={styles.list}>
            {kids.map((k, i) => (
              <View key={`${k.rank}-${k.first_name}`}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={styles.row}>
                  <RankBadge rank={k.rank} />
                  <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                    {k.first_name}
                  </ThemedText>
                  <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>{k.rating}</ThemedText>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const theme = useTheme();
  const medal = rank === 1 ? '#E5B53A' : rank === 2 ? '#A7AAB0' : rank === 3 ? '#B07A45' : null;
  return (
    <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
      <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>{rank}</ThemedText>
    </View>
  );
}

function Seg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.seg,
        { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder },
      ]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700' }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', gap: Spacing.two },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10, borderWidth: 1 },
  list: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
