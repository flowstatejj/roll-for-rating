import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { DropField, OptionRow, dropdownStyles } from '@/components/dropdowns';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { avatarSignedUrls } from '@/lib/avatars';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { scopeMatches, type Geo, type GeoLevel, type Scope, SCOPE_KEYS } from '@/lib/geo';
import { createMatchRequest } from '@/lib/invites';
import { fetchJuniors } from '@/lib/juniors';
import { fetchKidsLeaderboard, fetchLeaderboard, fetchMyGeo, type KidsLeaderRow, type LeaderRow } from '@/lib/matches';
import { fetchGymPowerRanking } from '@/lib/tournaments';
import type { GymPower, Profile } from '@/lib/types';
import { inWeightClass, weightClassFor, WEIGHT_FILTERS, type WeightClassKey } from '@/lib/weight';

type Tab = 'overall' | 'kids' | 'gyms';

export default function LeaderboardScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session?.user.id;

  const [tab, setTab] = useState<Tab>('overall');
  const [scope, setScope] = useState<Scope>('city'); // default to the member's own city
  const [weightFilter, setWeightFilter] = useState<WeightClassKey>(() => weightClassFor(profile?.weight_lbs) ?? 'absolute');
  const [openMenu, setOpenMenu] = useState<null | 'scope' | 'weight'>(null);
  const scopeTouched = useRef(false);
  const weightTouched = useRef(false);
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [gyms, setGyms] = useState<GymPower[]>([]);
  const [kids, setKids] = useState<KidsLeaderRow[]>([]);
  const [juniors, setJuniors] = useState<Profile[]>([]);
  const [myGeo, setMyGeo] = useState<Geo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canSeeKids = !!profile?.is_minor || juniors.length > 0;
  const myJuniorIds = useMemo(() => new Set(juniors.map((j) => j.id)), [juniors]);

  const load = useCallback(async () => {
    try {
      const [overall, gymRanks, juniorList, geo] = await Promise.all([
        fetchLeaderboard(),
        fetchGymPowerRanking().catch(() => []),
        userId ? fetchJuniors(userId).catch(() => []) : Promise.resolve([]),
        userId ? fetchMyGeo(userId).catch(() => null) : Promise.resolve(null),
      ]);
      setRows(overall);
      // One batched request to sign all the photo avatars for the board.
      avatarSignedUrls(overall.map((r) => r.avatar_path)).then(setAvatarUrls).catch(() => {});
      setGyms(gymRanks);
      setJuniors(juniorList);
      setMyGeo(geo);
    } catch (e) {
      console.warn('Failed to load leaderboard', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Default the weight filter to the member's own class once their profile loads,
  // unless they've already picked one.
  useEffect(() => {
    if (weightTouched.current) return;
    const own = weightClassFor(profile?.weight_lbs);
    if (own) setWeightFilter(own);
  }, [profile?.weight_lbs]);

  // Fall back off the "city" default to World only when the member has no city to
  // rank in (so the board isn't empty for someone who hasn't set a location).
  useEffect(() => {
    if (scopeTouched.current || scope !== 'city') return;
    if (myGeo && !myGeo.city) setScope('world');
  }, [myGeo, scope]);

  // Gym scope has no server-side kids board, so juniors fall back to World there.
  const kidsLevel: GeoLevel = scope === 'gym' ? 'world' : scope;

  // Kids board re-fetches per level (server filters by geography).
  useEffect(() => {
    if (!canSeeKids) return;
    fetchKidsLeaderboard(kidsLevel).then(setKids).catch((e) => console.warn('kids board', e));
  }, [kidsLevel, canSeeKids]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    if (canSeeKids) await fetchKidsLeaderboard(kidsLevel).then(setKids).catch(() => {});
    setRefreshing(false);
  }, [load, canSeeKids, kidsLevel]);

  const overallFiltered = useMemo(
    () =>
      rows
        .filter((r) => scopeMatches(myGeo, profile?.gym_id ?? null, r.geo, r.gym_id, scope))
        .filter((r) => inWeightClass(r.weight_lbs, weightFilter))
        .slice(0, 100),
    [rows, myGeo, scope, weightFilter, profile?.gym_id],
  );

  // Scope options exclude Gym on the kids board (no server gym filter for juniors).
  const scopeOptions = tab === 'kids' ? SCOPE_KEYS.filter((s) => s !== 'gym') : SCOPE_KEYS;
  const scopeLabel = (s: Scope) => t(s === 'gym' ? 'geo.gym' : `geo.${s}`);

  const selectTab = (tb: Tab) => {
    if (tb === 'kids' && scope === 'gym') { setScope('city'); scopeTouched.current = true; }
    setTab(tb);
    setOpenMenu(null);
  };
  const pickScope = (s: Scope) => { scopeTouched.current = true; setScope(s); setOpenMenu(null); };
  const pickWeight = (w: WeightClassKey) => { weightTouched.current = true; setWeightFilter(w); setOpenMenu(null); };

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={12}
          style={{ marginLeft: -4 }}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={28} color={theme.accent} />
        </Pressable>
        <ThemedText type="subtitle" style={{ fontSize: 28 }}>
          {t('lb.title')}
        </ThemedText>
      </View>

      <View style={styles.segment}>
        <Seg label={t('lb.overall')} active={tab === 'overall'} onPress={() => selectTab('overall')} />
        <Seg label={t('lb.gyms')} active={tab === 'gyms'} onPress={() => selectTab('gyms')} />
        {canSeeKids && <Seg label={t('lb.under13')} active={tab === 'kids'} onPress={() => selectTab('kids')} />}
      </View>

      {/* Scope + weight dropdowns (people boards only) */}
      {tab !== 'gyms' && (
        <View style={{ gap: Spacing.two }}>
          <View style={dropdownStyles.controls}>
            <DropField
              icon="earth-outline"
              text={scopeLabel(scope)}
              open={openMenu === 'scope'}
              onPress={() => setOpenMenu((m) => (m === 'scope' ? null : 'scope'))}
            />
            {tab === 'overall' && (
              <DropField
                icon="barbell-outline"
                text={t(`wc.${weightFilter}`)}
                open={openMenu === 'weight'}
                onPress={() => setOpenMenu((m) => (m === 'weight' ? null : 'weight'))}
              />
            )}
          </View>

          {openMenu === 'scope' && (
            <Card style={dropdownStyles.menu}>
              {scopeOptions.map((s) => (
                <OptionRow key={s} label={scopeLabel(s)} selected={scope === s} onPress={() => pickScope(s)} />
              ))}
            </Card>
          )}
          {openMenu === 'weight' && (
            <Card style={dropdownStyles.menu}>
              {WEIGHT_FILTERS.map((k) => (
                <OptionRow key={k} label={t(`wc.${k}`)} selected={weightFilter === k} onPress={() => pickWeight(k)} />
              ))}
            </Card>
          )}

          {scope === 'gym' && !profile?.gym_id && (
            <ThemedText type="small" themeColor="textSecondary">{t('lb.noGym')}</ThemedText>
          )}
          {scope !== 'gym' && scope !== 'world' && !myGeo?.[scope] && (
            <ThemedText type="small" themeColor="textSecondary">{t('lb.noGeo')}</ThemedText>
          )}
          {tab === 'overall' && weightFilter !== 'absolute' && (
            <ThemedText type="small" themeColor="textSecondary">{t('lb.weightNote')}</ThemedText>
          )}
        </View>
      )}

      {tab === 'gyms' ? (
        gyms.length === 0 ? (
          <EmptyState icon="barbell-outline" title={t('gr.emptyTitle')} subtitle={t('gr.emptySub')} />
        ) : (
          <Card style={styles.list}>
            {gyms.map((g, i) => {
              const mine = profile?.gym_id === g.gym_id;
              return (
                <View key={g.gym_id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <Pressable onPress={() => router.push(`/gym/${g.gym_id}`)} style={[styles.row, mine && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                    <RankBadge rank={i + 1} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                        {g.name}{mine ? ` ${t('lb.yours')}` : ''}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {g.member_count} {g.member_count === 1 ? t('gd.member') : t('gd.members')}{g.city ? ` · ${g.city}` : ''} · {g.total_wins} {t('gr.wins')}
                      </ThemedText>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{g.avg_rating}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{t('gr.avg')}</ThemedText>
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        )
      ) : tab === 'overall' || !canSeeKids ? (
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
                    <Pressable onPress={() => router.push(`/user/${p.id}`)} style={styles.tap}>
                      <Avatar
                        name={p.display_name}
                        size={40}
                        uri={p.avatar_path ? avatarUrls[p.avatar_path] : undefined}
                        warrior={p.avatar_warrior}
                        color={p.avatar_color}
                        founding={p.is_founding_member}
                      />
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
                    </Pressable>
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

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', gap: Spacing.two },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 10, borderWidth: 1 },
  list: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  tap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
