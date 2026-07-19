import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { MatchRow } from '@/components/match-row';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchMyMatches } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import type { MatchWithPeople } from '@/lib/types';

type Filter = 'all' | 'active' | 'completed' | 'reffing';
const FILTERS: { key: Filter; tkey: string }[] = [
  { key: 'all', tkey: 'matches.filterAll' },
  { key: 'active', tkey: 'matches.filterActive' },
  { key: 'completed', tkey: 'matches.filterCompleted' },
  { key: 'reffing', tkey: 'matches.filterReffing' },
];

const HISTORY_STATUSES = new Set(['completed', 'declined', 'cancelled']);

export default function MatchesScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const { t, lang } = useTranslation();
  const userId = session?.user.id;
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [showOlder, setShowOlder] = useState(false);

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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!userId) return;
    // Only the current user's matches (as challenger/opponent/referee), not the
    // whole table — avoids a full refetch on every unrelated public match change.
    const channel = supabase
      .channel('matches-tab')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `challenger_id=eq.${userId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `opponent_id=eq.${userId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `referee_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return <Loading />;

  // Is the next move on the current user? (Juniors' matches never are — the
  // guardian isn't a participant, so they land in "In progress" instead.)
  function needsMe(m: MatchWithPeople): boolean {
    if (m.status === 'pending_opponent') return m.opponent_id === userId;
    if (m.status === 'pending_referee') return m.referee_id === userId;
    if (m.status === 'pending_confirmation')
      return (m.challenger_id === userId || m.opponent_id === userId) && m.result_proposed_by !== userId;
    return false;
  }

  // Matches I'm OFFICIATING (referee, not a competitor). These live only under
  // the "Reffing" filter so they don't clutter the competitor views (or home).
  const isRefOnly = (m: MatchWithPeople) =>
    m.referee_id === userId && m.challenger_id !== userId && m.opponent_id !== userId;

  const hasRefMatches = matches.some(isRefOnly);
  const refPending = matches.filter((m) => isRefOnly(m) && m.status === 'pending_referee').length;
  // Only show the Reffing chip to people who actually referee; if the selected
  // filter is Reffing but there's nothing to ref, fall back to All.
  const shownFilters = hasRefMatches ? FILTERS : FILTERS.filter((f) => f.key !== 'reffing');
  const eff: Filter = filter === 'reffing' && !hasRefMatches ? 'all' : filter;

  const action: MatchWithPeople[] = [];
  const inProgress: MatchWithPeople[] = [];
  const history: MatchWithPeople[] = [];
  for (const m of matches) {
    const refOnly = isRefOnly(m);
    if (eff === 'reffing') {
      if (!refOnly) continue;
    } else if (refOnly) {
      continue; // officiating matches belong to the Reffing filter only
    }
    if (HISTORY_STATUSES.has(m.status)) {
      if (eff === 'active') continue;
      if (eff === 'completed' && m.status !== 'completed') continue;
      history.push(m);
    } else {
      if (eff === 'completed') continue;
      (needsMe(m) ? action : inProgress).push(m);
    }
  }

  // History grouped by month, newest first. Sort by the date shown in the
  // group (completion when there is one) so groups stay contiguous.
  const when = (m: MatchWithPeople) => new Date(m.completed_at ?? m.created_at);
  history.sort((a, b) => when(b).getTime() - when(a).getTime());
  const months: { title: string; items: MatchWithPeople[] }[] = [];
  for (const m of history) {
    const raw = when(m).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    const title = raw.charAt(0).toUpperCase() + raw.slice(1); // es/pt/fr months are lowercase
    const last = months[months.length - 1];
    if (last && last.title === title) last.items.push(m);
    else months.push({ title, items: [m] });
  }
  const visibleMonths = showOlder ? months : months.slice(0, 2);
  const hiddenOlder = showOlder ? 0 : months.slice(2).reduce((s, g) => s + g.items.length, 0);

  function section(key: string, header: string, headerColor: string | undefined, items: MatchWithPeople[]) {
    if (items.length === 0) return null;
    return (
      <View key={key} style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold" themeColor={headerColor ? undefined : 'textSecondary'} style={headerColor ? { color: headerColor } : undefined}>
          {header}
        </ThemedText>
        <Card style={{ paddingVertical: Spacing.one }}>
          {items.map((m, i) => (
            <View key={m.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <MatchRow match={m} currentUserId={userId!} />
            </View>
          ))}
        </Card>
      </View>
    );
  }

  const empty = action.length + inProgress.length + history.length === 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}>
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        {t('tab.matches')}
      </ThemedText>

      <View style={styles.filters}>
        {shownFilters.map((f) => {
          const active = eff === f.key;
          const showCount = f.key === 'reffing' && refPending > 0;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.accent : theme.tile,
                  borderColor: active ? theme.accent : theme.tileBorder,
                },
              ]}>
              <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
                {t(f.tkey)}
              </ThemedText>
              {showCount && (
                <View style={[styles.chipBadge, { backgroundColor: active ? theme.accentText : theme.danger }]}>
                  <ThemedText style={{ color: active ? theme.accent : '#fff', fontWeight: '800', fontSize: 10 }}>
                    {refPending > 9 ? '9+' : refPending}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <ErrorState onRetry={load} />
      ) : empty ? (
        <EmptyState icon="list-outline" title={t('matches.emptyTitle')} subtitle={t('matches.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.three }}>
          {section('action', t('matches.needsAction'), theme.accent, action)}
          {section('progress', t('matches.inProgress'), undefined, inProgress)}
          {visibleMonths.map((g) => section(g.title, g.title, undefined, g.items))}
          {hiddenOlder > 0 && (
            <Pressable
              onPress={() => setShowOlder(true)}
              style={[styles.older, { borderColor: theme.tileBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('matches.showOlder')}</ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  chipBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  older: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
});
