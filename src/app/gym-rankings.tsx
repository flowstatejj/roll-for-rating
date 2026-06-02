import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchGymPowerRanking } from '@/lib/tournaments';
import type { GymPower } from '@/lib/types';

export default function GymRankingsScreen() {
  const { profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [rows, setRows] = useState<GymPower[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchGymPowerRanking());
    } catch (e) {
      console.warn('gym ranking failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.gymRankings') }} />
      <ThemedText themeColor="textSecondary">{t('gr.intro')}</ThemedText>

      {rows.length === 0 ? (
        <EmptyState icon="barbell-outline" title={t('gr.emptyTitle')} subtitle={t('gr.emptySub')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {rows.map((g, i) => {
            const mine = profile?.gym_id === g.gym_id;
            const medal = i === 0 ? '#E5B53A' : i === 1 ? '#A7AAB0' : i === 2 ? '#B07A45' : null;
            return (
              <View key={g.gym_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <Pressable
                  onPress={() => router.push(`/gym/${g.gym_id}`)}
                  style={[styles.row, mine && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                  <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                    <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>{i + 1}</ThemedText>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                      {g.name}
                      {mine ? ` ${t('lb.yours')}` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {g.member_count} {g.member_count === 1 ? t('gd.member') : t('gd.members')}
                      {g.city ? ` · ${g.city}` : ''} · {g.total_wins} {t('gr.wins')}
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
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
