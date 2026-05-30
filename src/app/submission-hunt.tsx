import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { claimSubmissionRewards, fetchSubmissionCollection } from '@/lib/matches';
import { SUBMISSIONS } from '@/lib/types';

export default function SubmissionHuntScreen() {
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
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

  async function claim() {
    setClaiming(true);
    try {
      const res = await claimSubmissionRewards();
      await refreshProfile();
      await load();
      Alert.alert('Bonus claimed!', res.gained > 0 ? `+${res.gained} Elo — new rating ${res.new_rating}` : 'Nothing new to claim yet.');
    } catch (e: any) {
      Alert.alert('Could not claim', e.message ?? 'Try again.');
    } finally {
      setClaiming(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Submission Hunt' }} />
      <ThemedText themeColor="textSecondary">
        Finish matches with different submissions to collect them. Each new one is worth +15 Elo.
      </ThemedText>

      <Card style={{ alignItems: 'center', gap: Spacing.one }}>
        <ThemedText style={{ fontSize: 34, fontWeight: '800' }}>
          {collected}
          <ThemedText style={{ fontSize: 18, fontWeight: '700', color: theme.textSecondary }}> / {SUBMISSIONS.length}</ThemedText>
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {collected === SUBMISSIONS.length ? '🥋 Submission Specialist — full set!' : 'submissions collected'}
        </ThemedText>
      </Card>

      {unclaimed.length > 0 && (
        <Button label={`Claim +${unclaimed.length * 15} Elo`} icon="cash" loading={claiming} onPress={claim} />
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
                  +15 ready
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
