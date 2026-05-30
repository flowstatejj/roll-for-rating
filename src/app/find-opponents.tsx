import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchFriendlyOpponents } from '@/lib/social';
import type { Profile } from '@/lib/types';

export default function FindOpponentsScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session!.user.id;
  const [opponents, setOpponents] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.gym_id) {
      setLoading(false);
      return;
    }
    try {
      setOpponents(await fetchFriendlyOpponents(userId, profile.gym_id));
    } catch (e) {
      console.warn('load opponents failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId, profile?.gym_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  if (!profile?.gym_id) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Find opponents' }} />
        <EmptyState icon="barbell-outline" title="Join a gym first" subtitle="Opponents come from your gym and friendly gyms." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Find opponents' }} />
      <ThemedText themeColor="textSecondary">
        Competitors from your gym and gyms it&apos;s friends with. Tap to challenge.
      </ThemedText>

      {opponents.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No opponents yet"
          subtitle="Invite teammates to join, or have your gym friend other gyms."
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {opponents.map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/match/new?opponent=${p.id}`)}>
              <Card style={styles.row}>
                <Avatar name={p.display_name} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {p.display_name}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <BeltChip belt={p.belt_rank} size="sm" />
                    <ThemedText type="small" themeColor="textSecondary">
                      {p.rating}
                    </ThemedText>
                  </View>
                </View>
                <View style={[styles.challenge, { backgroundColor: theme.accent }]}>
                  <Ionicons name="flame" size={16} color={theme.accentText} />
                  <ThemedText style={{ color: theme.accentText, fontWeight: '700', fontSize: 13 }}>
                    Challenge
                  </ThemedText>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  challenge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
