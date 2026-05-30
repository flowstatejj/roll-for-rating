import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { createTournament, fetchTournaments } from '@/lib/tournaments';
import type { Tournament } from '@/lib/types';

const DURATIONS = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

function status(t: Tournament): { label: string; color: string } {
  const now = Date.now();
  const s = new Date(t.starts_at).getTime();
  const e = new Date(t.ends_at).getTime();
  if (now < s) return { label: 'Upcoming', color: '#D9822B' };
  if (now > e) return { label: 'Ended', color: '#9aa2ad' };
  return { label: 'Live', color: '#5c9a3a' };
}

export default function TournamentsScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const userId = session!.user.id;

  const [items, setItems] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchTournaments());
    } catch (e) {
      console.warn('tournaments failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submit() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your tournament a name.');
      return;
    }
    setBusy(true);
    try {
      const starts = new Date();
      const ends = new Date(starts.getTime() + days * 86400000);
      const id = await createTournament({
        name,
        hostId: userId,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      });
      router.replace(`/tournament/${id}`);
    } catch (e: any) {
      Alert.alert('Could not create', e.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Tournaments' }} />
      <ThemedText themeColor="textSecondary">
        Join an event and rack up wins during its window to climb the standings.
      </ThemedText>

      {creating ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>New tournament</ThemedText>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Spring Throwdown" />
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">Runs for</ThemedText>
            <View style={styles.chips}>
              {DURATIONS.map((d) => {
                const active = days === d.days;
                return (
                  <Pressable
                    key={d.days}
                    onPress={() => setDays(d.days)}
                    style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
                    <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>{d.label}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Button label="Create tournament" icon="trophy" loading={busy} onPress={submit} />
          <Button label="Cancel" variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label="Create a tournament" icon="trophy" onPress={() => setCreating(true)} />
      )}

      {items.length === 0 ? (
        <EmptyState icon="trophy-outline" title="No tournaments yet" subtitle="Create the first event for your scene." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {items.map((t) => {
            const st = status(t);
            return (
              <Pressable key={t.id} onPress={() => router.push(`/tournament/${t.id}`)}>
                <Card style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                    <Ionicons name="trophy" size={20} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{t.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(t.starts_at).toLocaleDateString()} – {new Date(t.ends_at).toLocaleDateString()}
                    </ThemedText>
                  </View>
                  <View style={[styles.badge, { backgroundColor: st.color + '22' }]}>
                    <ThemedText style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{st.label}</ThemedText>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
});
