import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { claimQuest, fetchQuests, pingActivity } from '@/lib/quests';
import type { Quest } from '@/lib/types';

export default function QuestsScreen() {
  const { profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingKey, setClaimingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await pingActivity().catch(() => {});
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
        Alert.alert('Quest complete!', `+${res.reward} Elo — new rating ${res.new_rating}`);
      } else {
        Alert.alert('Not yet', res.reason ?? 'Keep going.');
      }
    } catch (e: any) {
      Alert.alert('Could not claim', e.message ?? 'Try again.');
    } finally {
      setClaimingKey(null);
    }
  }

  if (loading || !profile) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Quests' }} />

      {/* Daily streak */}
      <Card style={styles.streak}>
        <Ionicons name="flame" size={28} color="#ff7a1a" />
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontSize: 22, fontWeight: '800' }}>
            {profile.activity_streak} day{profile.activity_streak === 1 ? '' : 's'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Daily streak — open the app each day to keep it alive
          </ThemedText>
        </View>
      </Card>

      <ThemedText style={styles.section}>This week&apos;s quests</ThemedText>
      <View style={{ gap: Spacing.two }}>
        {quests.map((q) => {
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
                    Claimed ✓
                  </ThemedText>
                ) : done ? (
                  <Button label="Claim" loading={claimingKey === q.key} onPress={() => claim(q)} variant="primary" />
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Quests reset every week.
      </ThemedText>
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
