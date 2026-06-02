import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { GEO_LEVELS, geoMatches, type Geo, type GeoLevel } from '@/lib/geo';
import { createMatchRequest } from '@/lib/invites';
import { fetchJuniors } from '@/lib/juniors';
import { fetchKidsLeaderboard, fetchLeaderboard, fetchMyGeo, type KidsLeaderRow, type LeaderRow } from '@/lib/matches';
import type { Profile } from '@/lib/types';

type Tab = 'overall' | 'kids';

export default function LeaderboardScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session?.user.id;

  const [tab, setTab] = useState<Tab>('overall');
  const [level, setLevel] = useState<GeoLevel>('world');
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [kids, setKids] = useState<KidsLeaderRow[]>([]);
  const [juniors, setJuniors] = useState<Profile[]>([]);
  const [myGeo, setMyGeo] = useState<Geo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canSeeKids = !!profile?.is_minor || juniors.length > 0;
  const myJuniorIds = useMemo(() => new Set(juniors.map((j) => j.id)), [juniors]);

  const load = useCallback(async () => {
    try {
      const [overall, juniorList, geo] = await Promise.all([
        fetchLeaderboard(),
        userId ? fetchJuniors(userId).catch(() => []) : Promise.resolve([]),
        userId ? fetchMyGeo(userId).catch(() => null) : Promise.resolve(null),
      ]);
      setRows(overall);
      setJuniors(juniorList);
      setMyGeo(geo);
    } catch (e) {
      console.warn('Failed to load leaderboard', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Kids board re-fetches per level (server filters by geography).
  useEffect(() => {
    if (!canSeeKids) return;
    fetchKidsLeaderboard(level).then(setKids).catch((e) => console.warn('kids board', e));
  }, [level, canSeeKids]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    if (canSeeKids) await fetchKidsLeaderboard(level).then(setKids).catch(() => {});
    setRefreshing(false);
  }, [load, canSeeKids, level]);

  const overallFiltered = useMemo(
    () => rows.filter((r) => geoMatches(myGeo, r.gym ?? null, level)).slice(0, 100),
    [rows, myGeo, level],
  );

  function challenge(row: KidsLeaderRow) {
    if (juniors.length === 0) return;
    const send = (jr: Profile) =>
      createMatchRequest(jr.id, row.junior_id)
        .then(() => Alert.alert('Challenge sent', `${row.first_name}'s guardian will be notified to accept and arrange the match.`))
        .catch((e: any) => Alert.alert('Could not send', e.message ?? 'Try again.'));
    if (juniors.length === 1) {
      Alert.alert('Send challenge?', `Challenge ${row.first_name} on behalf of ${juniors[0].display_name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => send(juniors[0]) },
      ]);
    } else {
      Alert.alert('Challenge as which junior?', `Challenging ${row.first_name}`, [
        ...juniors.slice(0, 5).map((j) => ({ text: j.display_name, onPress: () => send(j) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  if (loading) return <Loading />;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}>
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        {t('lb.title')}
      </ThemedText>

      {canSeeKids && (
        <View style={styles.segment}>
          <Seg label={t('lb.overall')} active={tab === 'overall'} onPress={() => setTab('overall')} />
          <Seg label={t('lb.under13')} active={tab === 'kids'} onPress={() => setTab('kids')} />
        </View>
      )}

      {/* Geographic level */}
      <View style={styles.levels}>
        {GEO_LEVELS.map((l) => (
          <Chip key={l.key} label={t(`geo.${l.key}`)} active={level === l.key} onPress={() => setLevel(l.key)} />
        ))}
      </View>
      {level !== 'world' && !myGeo?.[level] && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('lb.noGeo')}
        </ThemedText>
      )}

      {tab === 'overall' || !canSeeKids ? (
        overallFiltered.length === 0 ? (
          <EmptyState icon="podium-outline" title={t('lb.emptyTitle')} subtitle={t('lb.emptySub')} />
        ) : (
          <Card style={styles.list}>
            {overallFiltered.map((p, i) => {
              const isMe = p.id === userId;
              return (
                <View key={p.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                    <RankBadge rank={i + 1} />
                    <Avatar name={p.display_name} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                        {p.display_name}
                        {isMe ? ` ${t('lb.you')}` : ''}
                      </ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                        <BeltChip belt={p.belt_rank} size="sm" />
                        <ThemedText type="small" themeColor="textSecondary">
                          {p.wins}{t('lb.w')} · {p.losses}{t('lb.l')} · {p.draws}{t('lb.d')}
                        </ThemedText>
                      </View>
                    </View>
                    <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>{p.rating}</ThemedText>
                    {!isMe && (
                      <Pressable
                        onPress={() => router.push(`/match/new?opponent=${p.id}`)}
                        hitSlop={8}
                        style={{ marginLeft: Spacing.two }}>
                        <Ionicons name="flash" size={20} color={theme.accent} />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </Card>
        )
      ) : (
        <>
          {juniors.length > 0 && (
            <Button label={t('profile.juniorChallenges')} variant="secondary" icon="mail-outline" onPress={() => router.push('/invites')} />
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {t('lb.kidsNote')}
          </ThemedText>
          {kids.length === 0 ? (
            <EmptyState icon="happy-outline" title={t('lb.kidsEmptyTitle')} subtitle={t('lb.kidsEmptySub')} />
          ) : (
            <Card style={styles.list}>
              {kids.map((k, i) => {
                const mine = myJuniorIds.has(k.junior_id);
                return (
                  <View key={k.junior_id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                    <View style={styles.row}>
                      <RankBadge rank={k.rank} />
                      <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                        {k.first_name}
                        {mine ? ` ${t('lb.yours')}` : ''}
                      </ThemedText>
                      <ThemedText style={{ fontWeight: '800', fontSize: 20 }}>{k.rating}</ThemedText>
                      {juniors.length > 0 && !mine && (
                        <Pressable onPress={() => challenge(k)} hitSlop={8} style={{ marginLeft: Spacing.two }}>
                          <Ionicons name="flash" size={20} color={theme.accent} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
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
      style={[styles.seg, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700' }}>{label}</ThemedText>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 12 }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', gap: Spacing.two },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10, borderWidth: 1 },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  list: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
