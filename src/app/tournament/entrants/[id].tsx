import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

/**
 * Full entrants list for a tournament, on its own screen so the main event page
 * stays compact: scrollable, searchable by name/username, tap-through to
 * profiles. Replaces the old inline 64-row wall.
 */
export default function TournamentEntrantsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [entrants, setEntrants] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('tournament_entrants')
        .select('profile:profiles(id, username, display_name, belt_rank, rating, is_minor, avatar_warrior, avatar_color)')
        .eq('tournament_id', id);
      setEntrants(((data ?? []).map((e: any) => e.profile).filter(Boolean)) as Profile[]);
    } catch (e) {
      console.warn('entrants load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...entrants].sort((a, b) => a.display_name.localeCompare(b.display_name));
    if (!needle) return sorted;
    return sorted.filter(
      (p) => p.display_name.toLowerCase().includes(needle) || p.username.toLowerCase().includes(needle),
    );
  }, [entrants, q]);

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: `${t('tn.entrants')} · ${entrants.length}` }} />

      <TextField value={q} onChangeText={setQ} placeholder={t('mn.searchPlaceholder')} autoCapitalize="none" />

      {visible.length === 0 ? (
        // A search miss is not "no entrants" - the event may be full.
        q.trim() && entrants.length > 0 ? (
          <EmptyState icon="search-outline" title={t('tn.noSearchResults')} subtitle="" />
        ) : (
          <EmptyState icon="people-outline" title={t('tn.noEntrants')} subtitle="" />
        )
      ) : (
        <Card style={{ paddingVertical: Spacing.one }}>
          {visible.map((p, i) => (
            <View key={p.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <Pressable onPress={() => router.push(`/user/${p.id}`)} style={styles.prow}>
                <Avatar name={p.display_name} size={36} warrior={p.avatar_warrior ?? undefined} color={p.avatar_color ?? undefined} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{p.display_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>@{p.username}</ThemedText>
                </View>
                <BeltChip belt={p.belt_rank} size="sm" />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  prow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
