import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { claimQuest, fetchQuests } from '@/lib/quests';
import type { Quest } from '@/lib/types';

export default function QuestsScreen() {
  const { profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await refreshProfile();
      setQuests(await fetchQuests());
    } catch (e) {
      console.warn('quests failed', e);
    } finally {
      setLoading(false);
    }
  }, [refreshProfile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function claim(q: Quest) {
    setClaimingKey(q.key);
    try {
      const res = await claimQuest(q.key);
      if (res.ok) {
        await refreshProfile();
        setQuests(await fetchQuests());
        Alert.alert(t('q.completeTitle'), t('q.completeBody').replace('{n}', String(res.reward)).replace('{r}', String(res.new_rating)));
      } else {
        Alert.alert(t('q.notYet'), res.reason ?? '');
      }
    } catch (e: any) {
      Alert.alert(t('sh.claimFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setClaimingKey(null);
    }
  }

  if (loading || !profile) return <Loading />;

  const weekly = quests.filter((q) => q.period !== 'once');
  const challenges = quests.filter((q) => q.period === 'once');

  const renderQuest = (q: Quest) => {
    const done = q.progress >= q.target;
    const pct = Math.min(1, q.progress / q.target);
    return (
      <Card key={q.key} style={{ gap: Spacing.two }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <ThemedText style={{ fontWeight: '800', flex: 1 }}>{q.title}</ThemedText>
          <View style={[styles.reward, { backgroundColor: theme.accent + '22' }]}>
            <Ionicons name="cash" size={13} color={theme.accent} />
            <ThemedText type="small" style={{ color: theme.accent, fontWeight: '800' }}>
              +{q.reward}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: done ? theme.success : theme.accent }]} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            {Math.min(q.progress, q.target)} / {q.target}
          </ThemedText>
          {q.claimed ? (
            <ThemedText type="small" style={{ color: theme.success, fontWeight: '800' }}>
              {t('q.claimed')} ✓
            </ThemedText>
          ) : done ? (
            <Button label={t('sh.claim')} loading={claimingKey === q.key} onPress={() => claim(q)} variant="primary" />
          ) : null}
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.quests') }} />

      <ThemedText style={styles.section}>{t('q.weekQuests')}</ThemedText>
      <View style={{ gap: Spacing.two }}>{weekly.map(renderQuest)}</View>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {t('q.reset')}
      </ThemedText>

      {challenges.length > 0 && (
        <>
          <ThemedText style={styles.section}>{t('q.challenges')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('q.challengesSub')}</ThemedText>
          <View style={{ gap: Spacing.two }}>{challenges.map(renderQuest)}</View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  streak: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
