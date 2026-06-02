import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchCard } from '@/components/match-card';
import { MatchRow } from '@/components/match-row';
import { TatamiBackground } from '@/components/tatami-background';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, ErrorState, Loading } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUnread } from '@/hooks/use-unread';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { winStreak } from '@/lib/elo';
import { fetchMyMatches } from '@/lib/matches';
import { pingActivity } from '@/lib/quests';
import { tierFor } from '@/lib/tiers';
import { supabase } from '@/lib/supabase';
import type { MatchWithPeople } from '@/lib/types';

const SCREEN_W = Dimensions.get('window').width;
const HERO_W = Math.min(SCREEN_W - 64, 360);

export default function HomeScreen() {
  const { profile, refreshProfile, session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const unread = useUnread();

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setMatches(await fetchMyMatches(userId));
      setError(false);
    } catch (e) {
      console.warn('Failed to load matches', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshProfile();
      pingActivity().catch(() => {});
    }, [load, refreshProfile]),
  );

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
  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
  const drawRate = total > 0 ? Math.round((profile.draws / total) * 100) : 0;
  const streak = winStreak(matches, userId!);
  const tier = tierFor(profile.rating);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <TatamiBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.topSide}>
            <Pressable onPress={() => router.push('/(tabs)/profile')}>
              <Avatar name={profile.display_name} size={36} />
            </Pressable>
          </View>
          <View style={styles.brand}>
            <View style={[styles.logoMark, { backgroundColor: theme.accent }]}>
              <Ionicons name="body" size={16} color={theme.accentText} />
            </View>
            <ThemedText style={styles.brandText} numberOfLines={1}>
              Roll for Rating
            </ThemedText>
          </View>
          <View style={[styles.topSide, styles.topRight]}>
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8}>
              <Ionicons name="notifications" size={24} color={theme.text} />
              {unread > 0 && (
                <View style={[styles.bellBadge, { backgroundColor: theme.danger }]}>
                  <ThemedText style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                    {unread > 9 ? '9+' : unread}
                  </ThemedText>
                </View>
              )}
            </Pressable>
            <Pressable onPress={() => router.push('/(tabs)/leaderboard')} hitSlop={8}>
              <Ionicons name="podium" size={24} color={theme.text} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}>
          {/* Hero cards */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.heroRow}
            snapToInterval={HERO_W + Spacing.two}
            decelerationRate="fast">
            <Pressable onPress={() => router.push('/match/new')}>
              <View style={[styles.hero, { width: HERO_W, backgroundColor: theme.accent }]}>
                <Ionicons name="flame" size={40} color={theme.accentText} style={{ opacity: 0.9 }} />
                <View style={{ gap: 2 }}>
                  <ThemedText style={{ color: theme.accentText, fontSize: 24, fontWeight: '800' }}>
                    {t('home.startMatch')}
                  </ThemedText>
                  <ThemedText style={{ color: theme.accentText, opacity: 0.9 }}>
                    {t('home.startMatchSub')}
                  </ThemedText>
                </View>
              </View>
            </Pressable>

            <Pressable onPress={() => router.push('/(tabs)/leaderboard')}>
              <View style={[styles.hero, { width: HERO_W, backgroundColor: theme.tile, borderColor: theme.tileBorder, borderWidth: 1 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('home.yourRating')}
                  </ThemedText>
                  {streak >= 2 && (
                    <View style={styles.streak}>
                      <Ionicons name="flame" size={14} color="#ff7a1a" />
                      <ThemedText style={{ color: '#ff7a1a', fontWeight: '800', fontSize: 13 }}>
                        {streak} {t('home.winStreak')}
                      </ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText style={{ fontSize: 48, fontWeight: '800', lineHeight: 50 }}>
                  {profile.rating}
                </ThemedText>
                <ThemedText type="small" style={{ color: tier.tier.color, fontWeight: '800' }}>
                  {tier.tier.name}
                  {tier.next ? ` · ${tier.toNext} to ${tier.next.name}` : ''}
                </ThemedText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                  <BeltChip belt={profile.belt_rank} size="sm" />
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('home.viewRankings')}
                  </ThemedText>
                </View>
              </View>
            </Pressable>
          </ScrollView>

          {/* Stats tiles */}
          <SectionLabel>{t('home.yourStats')}</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tileRow}>
            <StatTile icon="trending-up" value={profile.rating} label={t('home.statRating')} />
            <StatTile icon="trophy" value={profile.wins} label={t('home.statWins')} />
            <StatTile icon="pie-chart" value={`${winRate}%`} label={t('home.statWinRate')} />
            <StatTile icon="pie-chart-outline" value={`${drawRate}%`} label={t('home.statDrawRate')} />
            <StatTile icon="albums" value={total} label={t('home.statMatches')} />
          </ScrollView>

          {/* Needs attention */}
          {needsMe.length > 0 && (
            <>
              <SectionLabel>{t('home.needsAttention')}</SectionLabel>
              <View style={{ gap: Spacing.two }}>
                {needsMe.map((m) => (
                  <MatchCard key={m.id} match={m} currentUserId={userId!} />
                ))}
              </View>
            </>
          )}

          {/* Recent matches — chess.com Game History style */}
          <SectionLabel>{t('home.recentMatches')}</SectionLabel>
          {error ? (
            <ErrorState onRetry={load} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon="hand-left-outline"
              title={t('home.noMatchesTitle')}
              subtitle={t('home.noMatchesSub')}
            />
          ) : (
            <Card style={{ paddingVertical: Spacing.one }}>
              {recent.map((m, i) => (
                <View key={m.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <MatchRow match={m} currentUserId={userId!} />
                </View>
              ))}
              <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />
              <Pressable onPress={() => router.push('/(tabs)/matches')} style={styles.viewAll}>
                <ThemedText style={{ fontWeight: '700', color: theme.accent }}>{t('home.viewAll')}</ThemedText>
              </Pressable>
            </Card>
          )}
        </ScrollView>

        {/* Pinned action button */}
        <View style={styles.pinned} pointerEvents="box-none">
          <Button label={t('home.newChallenge')} icon="add-circle" onPress={() => router.push('/match/new')} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText style={styles.sectionLabel}>{children}</ThemedText>
  );
}

function StatTile({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.tile}>
      <Ionicons name={icon} size={22} color={theme.accent} />
      <ThemedText style={{ fontSize: 22, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  topSide: { flex: 1, justifyContent: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.three },
  bellBadge: { position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  logoMark: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: 110 },
  heroRow: { gap: Spacing.two, paddingRight: Spacing.three },
  hero: {
    height: 150,
    borderRadius: 14,
    padding: Spacing.three,
    justifyContent: 'space-between',
  },
  sectionLabel: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  tileRow: { gap: Spacing.two, paddingRight: Spacing.three },
  tile: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', gap: 4 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ff7a1a22', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  viewAll: { alignItems: 'center', paddingVertical: Spacing.two },
  pinned: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
  },
});
