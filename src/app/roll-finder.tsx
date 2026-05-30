import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchOpenChallengers } from '@/lib/social';
import { BELT_LABELS, type BeltRank, type Profile } from '@/lib/types';

const BELTS: (BeltRank | 'any')[] = ['any', 'white', 'blue', 'purple', 'brown', 'black'];

export default function RollFinderScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session!.user.id;

  const [city, setCity] = useState(profile?.city ?? '');
  const [belt, setBelt] = useState<BeltRank | 'any'>('any');
  const [results, setResults] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    try {
      setResults(
        await fetchOpenChallengers(userId, { city, belt: belt === 'any' ? null : belt }),
      );
    } catch (e) {
      console.warn('roll finder failed', e);
    }
  }, [userId, city, belt]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Roll Finder' }} />
      <ThemedText themeColor="textSecondary">
        People who are open for a challenge. Filter by area and belt, then tap to challenge.
      </ThemedText>

      <TextField label="Area / city" value={city} onChangeText={setCity} autoCapitalize="words" placeholder="Any city" />

      <View style={styles.belts}>
        {BELTS.map((b) => {
          const active = belt === b;
          return (
            <Pressable
              key={b}
              onPress={() => setBelt(b)}
              style={[
                styles.chip,
                { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder },
              ]}>
              <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
                {b === 'any' ? 'Any belt' : BELT_LABELS[b]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {results.length === 0 ? (
        <EmptyState
          icon="flame-outline"
          title="No one's open right now"
          subtitle="Try a wider area, or toggle yourself open so others find you."
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {results.map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/match/new?opponent=${p.id}`)}>
              <Card style={styles.row}>
                <Avatar name={p.display_name} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {p.display_name}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' }}>
                    <BeltChip belt={p.belt_rank} size="sm" />
                    <ThemedText type="small" themeColor="textSecondary">
                      {p.rating}
                      {p.city ? ` · ${p.city}` : ''}
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
  belts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  challenge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
