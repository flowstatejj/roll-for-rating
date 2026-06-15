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
import { claimSubmissionRewards, fetchSubmissionCollection } from '@/lib/matches';
import { SUBMISSION_ROR, SUBMISSIONS } from '@/lib/types';

export default function SubmissionHuntScreen() {
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;
  const [won, setWon] = useState<string[]>([]);
  const [rewarded, setRewarded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await fetchSubmissionCollection(userId);
      setWon(c.won);
      setRewarded(c.rewarded);
    } catch (e) {
      console.warn('hunt load failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const wonSet = new Set(won);
  const rewardedSet = new Set(rewarded);
  const huntable = SUBMISSIONS.filter((s) => wonSet.has(s));
  const collected = huntable.length;
  const unclaimed = huntable.filter((s) => !rewardedSet.has(s));
  const rorFor = (s: string) => SUBMISSION_ROR[s] ?? 15;
  const unclaimedRor = unclaimed.reduce((sum, s) => sum + rorFor(s), 0);

  async function claim() {
    setClaiming(true);
    try {
      const res = await claimSubmissionRewards();
      await refreshProfile();
      await load();
      Alert.alert(
        t('sh.claimedTitle'),
        res.gained > 0
          ? t('sh.claimedBody').replace('{n}', String(res.gained)).replace('{r}', String(res.new_rating))
          : t('sh.nothingNew'),
      );
    } catch (e: any) {
      Alert.alert(t('sh.claimFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setClaiming(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.submissionHunt') }} />
      <ThemedText themeColor="textSecondary">
        {t('sh.intro')}
      </ThemedText>

      <Card style={{ alignItems: 'center', gap: Spacing.one }}>
        <ThemedText style={{ fontSize: 34, fontWeight: '800' }}>
          {collected}
          <ThemedText style={{ fontSize: 18, fontWeight: '700', color: theme.textSecondary }}> / {SUBMISSIONS.length}</ThemedText>
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {collected === SUBMISSIONS.length ? t('sh.fullSet') : t('sh.collected')}
        </ThemedText>
      </Card>

      {unclaimed.length > 0 && (
        <Button label={`${t('sh.claim')} +${unclaimedRor} ROR`} icon="cash" loading={claiming} onPress={claim} />
      )}

      <View style={styles.grid}>
        {SUBMISSIONS.map((s) => {
          const got = wonSet.has(s);
          return (
            <Card key={s} style={[styles.tile, { opacity: got ? 1 : 0.45, borderColor: got ? theme.accent : theme.tileBorder }]}>
              <Ionicons name={got ? 'lock-open' : 'lock-closed'} size={20} color={got ? theme.accent : theme.textSecondary} />
              <ThemedText style={{ fontWeight: '700', fontSize: 12, textAlign: 'center' }} numberOfLines={2}>
                {s}
              </ThemedText>
              {got && !rewardedSet.has(s) && (
                <ThemedText type="small" style={{ color: theme.success, fontWeight: '800' }}>
                  +{rorFor(s)} {t('sh.ready')}
                </ThemedText>
              )}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexBasis: '31%', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.three, borderWidth: 1, minHeight: 92 },
});
