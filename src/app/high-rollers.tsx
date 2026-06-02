import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchWagerLeaderboard, type WagerLeader } from '@/lib/matches';

export default function HighRollersScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session?.user.id;
  const [rows, setRows] = useState<WagerLeader[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchWagerLeaderboard());
    } catch (e) {
      console.warn('wager leaderboard failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.biggestPots') }} />
      <ThemedText themeColor="textSecondary">{t('hr.intro')}</ThemedText>

      {rows.length === 0 ? (
        <EmptyState icon="cash-outline" title={t('hr.emptyTitle')} subtitle={t('hr.emptySub')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {rows.map((r, i) => {
            const isMe = r.user_id === userId;
            const rank = i + 1;
            const medal = rank === 1 ? '#E5B53A' : rank === 2 ? '#A7AAB0' : rank === 3 ? '#B07A45' : null;
            return (
              <View key={r.user_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                  <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                    <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>
                      {rank}
                    </ThemedText>
                  </View>
                  <Avatar name={r.display_name} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                      {r.display_name}
                      {isMe ? ` ${t('lb.you')}` : ''}
                    </ThemedText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                      <BeltChip belt={r.belt_rank} size="sm" />
                      <ThemedText type="small" themeColor="textSecondary">
                        {r.wagered_wins} {r.wagered_wins === 1 ? t('hr.potWon') : t('hr.potsWon')}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="cash" size={16} color={theme.success} />
                    <ThemedText style={{ fontWeight: '800', fontSize: 18, color: theme.success }}>
                      {r.pot_won}
                    </ThemedText>
                  </View>
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
