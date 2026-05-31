import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { parseDob } from '@/lib/dob';
import { addJunior, fetchJuniors, removeJunior } from '@/lib/juniors';
import { BELT_LABELS, type BeltRank, type Profile } from '@/lib/types';

const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

export default function JuniorsScreen() {
  const { profile } = useAuth();
  const theme = useTheme();

  const [juniors, setJuniors] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // add-form state
  const [name, setName] = useState('');
  const [belt, setBelt] = useState<BeltRank>('white');
  const [dobM, setDobM] = useState('');
  const [dobD, setDobD] = useState('');
  const [dobY, setDobY] = useState('');

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setJuniors(await fetchJuniors(profile.id));
    } catch (e) {
      console.warn('Failed to load juniors', e);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function resetForm() {
    setName('');
    setBelt('white');
    setDobM('');
    setDobD('');
    setDobY('');
    setAdding(false);
  }

  async function onAdd() {
    if (!profile) return;
    if (!name.trim()) {
      Alert.alert('Name needed', "Enter the junior's name.");
      return;
    }
    const dob = parseDob(dobM, dobD, dobY);
    if (!dob) {
      Alert.alert('Date of birth', 'Enter a valid date of birth (MM / DD / YYYY).');
      return;
    }
    if (dob.age >= 14 || dob.age < 0) {
      Alert.alert('Under 14 only', 'Managed junior accounts are for members under 14. A 14–17 member should make their own account with parent approval.');
      return;
    }
    setBusy(true);
    try {
      await addJunior({
        guardianId: profile.id,
        displayName: name.trim(),
        beltRank: belt,
        birthdate: dob.iso,
        gymId: profile.gym_id,
      });
      resetForm();
      await load();
    } catch (e: any) {
      Alert.alert('Could not add', e.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(j: Profile) {
    Alert.alert(
      `Remove ${j.display_name}?`,
      "This permanently deletes this junior's profile, matches, and rating. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeJunior(j.id);
              await load();
            } catch (e: any) {
              Alert.alert('Could not remove', e.message ?? 'Try again.');
            }
          },
        },
      ],
    );
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'My juniors' }} />

      <ThemedText type="small" themeColor="textSecondary">
        Under-14 members you manage. You operate their account from yours — they don&apos;t log in.
        They can&apos;t wager, aren&apos;t publicly searchable, and only match other under-18 members.
      </ThemedText>

      {juniors.length === 0 && !adding ? (
        <EmptyState icon="happy-outline" title="No juniors yet" subtitle="Add a child you manage to start tracking their rolls." />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {juniors.map((j) => (
            <Card key={j.id} style={styles.row}>
              <BeltChip belt={j.belt_rank} />
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: '800' }}>{j.display_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {BELT_LABELS[j.belt_rank]} • {j.rating} • {j.wins}-{j.losses}-{j.draws}
                </ThemedText>
              </View>
              <Pressable onPress={() => confirmRemove(j)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={theme.danger} />
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      {adding ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontWeight: '800', fontSize: 16 }}>Add a junior</ThemedText>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="First name" />

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">Belt rank</ThemedText>
            <View style={styles.belts}>
              {BELTS.map((b) => {
                const selected = belt === b;
                return (
                  <Pressable
                    key={b}
                    onPress={() => setBelt(b)}
                    style={[
                      styles.beltOption,
                      { backgroundColor: selected ? theme.accent : theme.backgroundElement, borderColor: selected ? theme.accent : theme.border },
                    ]}>
                    <ThemedText style={{ fontWeight: '700', fontSize: 13, color: selected ? theme.accentText : theme.text }}>
                      {BELT_LABELS[b]}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">Date of birth</ThemedText>
            <View style={styles.dobRow}>
              <View style={{ flex: 1 }}>
                <TextField label="MM" value={dobM} onChangeText={(t) => setDobM(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="MM" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label="DD" value={dobD} onChangeText={(t) => setDobD(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="DD" />
              </View>
              <View style={{ flex: 1.6 }}>
                <TextField label="YYYY" value={dobY} onChangeText={(t) => setDobY(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="YYYY" />
              </View>
            </View>
          </View>

          <Button label="Add junior" icon="add" loading={busy} onPress={onAdd} />
          <Button label="Cancel" variant="ghost" onPress={resetForm} />
        </Card>
      ) : (
        <Button label="Add a junior" icon="add" variant="secondary" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  belts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  beltOption: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 10, borderWidth: 1 },
  dobRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
});
