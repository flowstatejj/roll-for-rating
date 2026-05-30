import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchChampions, type Champion } from '@/lib/titles';

export default function ChampionsScreen() {
  const { profile } = useAuth();
  const theme = useTheme();
  const [champs, setChamps] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setChamps(await fetchChampions(profile));
    } catch (e) {
      console.warn('champions failed', e);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Champions' }} />
      <ThemedText themeColor="textSecondary">
        Titles are held by whoever sits #1. Beat them in rating to take the crown. 👑
      </ThemedText>

      {champs.length === 0 ? (
        <EmptyState icon="trophy-outline" title="No titles yet" subtitle="Join a gym and set your city to unlock more titles." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {champs.map((c) => (
            <Card key={c.key} style={[styles.row, c.isMe && { borderColor: theme.accent, borderWidth: 1.5 }]}>
              <ThemedText style={{ fontSize: 26 }}>👑</ThemedText>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText style={{ fontWeight: '800' }}>{c.title}</ThemedText>
                {c.champ ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <Avatar name={c.champ.display_name} size={28} />
                    <ThemedText type="small" themeColor="textSecondary">
                      {c.champ.display_name}
                      {c.isMe ? ' (you)' : ''} · {c.champ.rating}
                    </ThemedText>
                    <BeltChip belt={c.champ.belt_rank} size="sm" />
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Vacant — claim it
                  </ThemedText>
                )}
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
