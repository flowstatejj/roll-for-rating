import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchMyMatches } from '@/lib/matches';
import { computeRivalries, type Rivalry } from '@/lib/rivalries';

export default function RivalriesScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;
  const [rivalries, setRivalries] = useState<Rivalry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const ms = await fetchMyMatches(userId);
      setRivalries(computeRivalries(ms, userId));
    } catch (e) {
      console.warn('rivalries failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.rivalries') }} />
      <ThemedText themeColor="textSecondary">{t('riv.intro')}</ThemedText>

      {rivalries.length === 0 ? (
        <EmptyState icon="git-compare-outline" title={t('riv.emptyTitle')} subtitle={t('riv.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {rivalries.map((r) => {
            const leading = r.wins > r.losses;
            const trailing = r.wins < r.losses;
            return (
              <Card key={r.opponentId} style={styles.row}>
                <Avatar name={r.name} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {r.name}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <BeltChip belt={r.belt} size="sm" />
                    <ThemedText
                      type="small"
                      style={{ fontWeight: '800', color: leading ? theme.success : trailing ? theme.danger : theme.textSecondary }}>
                      {r.wins}–{r.losses}
                      {r.draws ? `–${r.draws}` : ''}
                    </ThemedText>
                  </View>
                </View>
                <Pressable onPress={() => router.push(`/match/new?opponent=${r.opponentId}`)} style={[styles.rematch, { backgroundColor: theme.accent }]}>
                  <Ionicons name="repeat" size={15} color={theme.accentText} />
                  <ThemedText style={{ color: theme.accentText, fontWeight: '700', fontSize: 13 }}>{t('riv.rematch')}</ThemedText>
                </Pressable>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rematch: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
