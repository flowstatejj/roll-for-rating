import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { createGym, fetchGyms } from '@/lib/social';
import type { Gym } from '@/lib/types';

export default function GymsScreen() {
  const { profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGyms(await fetchGyms(query));
    } catch (e) {
      console.warn('load gyms failed', e);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submitCreate() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your gym a name.');
      return;
    }
    setBusy(true);
    try {
      const gym = await createGym(name.trim(), city.trim(), state.trim(), country.trim(), description.trim());
      await refreshProfile();
      router.replace(`/gym/${gym.id}`);
    } catch (e: any) {
      Alert.alert('Could not create gym', e.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Gyms' }} />

      {creating ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>Create a gym</ThemedText>
          <TextField label="Gym name" value={name} onChangeText={setName} placeholder="Gracie Barra Springfield" />
          <TextField label="City" value={city} onChangeText={setCity} placeholder="Springfield" />
          <TextField label="State / region" value={state} onChangeText={setState} placeholder="Illinois" />
          <TextField label="Country" value={country} onChangeText={setCountry} placeholder="United States" />
          <ThemedText type="small" themeColor="textSecondary">
            Location powers the City / State / Country / Continent / World leaderboards.
          </ThemedText>
          <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline placeholder="A bit about the academy" />
          <Button label="Create gym" icon="add-circle" loading={busy} onPress={submitCreate} />
          <Button label="Cancel" variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label="Create a new gym" icon="add-circle" onPress={() => setCreating(true)} />
      )}

      <TextField
        label="Search gyms"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        placeholder="Name or city"
      />

      <View style={{ gap: Spacing.two }}>
        {gyms.map((g) => {
          const mine = profile?.gym_id === g.id;
          return (
            <Pressable key={g.id} onPress={() => router.push(`/gym/${g.id}`)}>
              <Card style={styles.row}>
                <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                  <Ionicons name="barbell" size={20} color={theme.text} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {g.name}
                    {mine ? ' (your gym)' : ''}
                  </ThemedText>
                  {g.city ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {g.city}
                    </ThemedText>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Card>
            </Pressable>
          );
        })}
        {gyms.length === 0 && (
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: Spacing.three }}>
            No gyms found. Create the first one!
          </ThemedText>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
