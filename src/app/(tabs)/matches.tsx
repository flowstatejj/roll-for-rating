import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { MatchRow } from '@/components/match-row';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchMyMatches } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import type { MatchWithPeople } from '@/lib/types';

type Filter = 'all' | 'active' | 'completed';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

export default function MatchesScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const userId = session?.user.id;
  const [matches, setMatches] = useState<MatchWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setMatches(await fetchMyMatches(userId));
    } catch (e) {
      console.warn('Failed to load matches', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const channel = supabase
      .channel('matches-tab')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return <Loading />;

  const filtered = matches.filter((m) => {
    if (filter === 'active') return m.status === 'pending_opponent' || m.status === 'pending_referee';
    if (filter === 'completed') return m.status === 'completed';
    return true;
  });

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}>
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        Matches
      </ThemedText>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
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
                {f.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {filtered.length === 0 ? (
        <EmptyState icon="list-outline" title="Nothing here yet" subtitle="Matches you compete in or referee will show up here." />
      ) : (
        <Card style={{ paddingVertical: Spacing.one }}>
          {filtered.map((m, i) => (
            <View key={m.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <MatchRow match={m} currentUserId={userId!} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: Spacing.two },
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
});
