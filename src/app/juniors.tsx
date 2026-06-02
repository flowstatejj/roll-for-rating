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
import { useTranslation } from '@/lib/i18n';
import { addJunior, fetchJuniors, removeJunior } from '@/lib/juniors';
import { type BeltRank, type Profile } from '@/lib/types';

const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

export default function JuniorsScreen() {
  const { profile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();

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
      Alert.alert(t('jr.nameNeededTitle'), t('jr.nameNeededBody'));
      return;
    }
    const dob = parseDob(dobM, dobD, dobY);
    if (!dob) {
      Alert.alert(t('su.dob'), t('jr.dobInvalid'));
      return;
    }
    if (dob.age >= 14 || dob.age < 0) {
      Alert.alert(t('jr.under14Title'), t('jr.under14Body'));
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
      Alert.alert(t('jr.addFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(j: Profile) {
    Alert.alert(
      t('jr.removeTitle').replace('{name}', j.display_name),
      t('jr.removeBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('om.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeJunior(j.id);
              await load();
            } catch (e: any) {
              Alert.alert(t('jr.removeFail'), e.message ?? t('md.tryAgain'));
            }
          },
        },
      ],
    );
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('profile.myJuniors') }} />

      <ThemedText type="small" themeColor="textSecondary">
        {t('jr.intro')}
      </ThemedText>

      {juniors.length === 0 && !adding ? (
        <EmptyState icon="happy-outline" title={t('jr.emptyTitle')} subtitle={t('jr.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {juniors.map((j) => (
            <Card key={j.id} style={styles.row}>
              <BeltChip belt={j.belt_rank} />
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: '800' }}>{j.display_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t(`belt.${j.belt_rank}`)} • {j.rating} • {j.wins}-{j.losses}-{j.draws}
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
          <ThemedText style={{ fontWeight: '800', fontSize: 16 }}>{t('jr.add')}</ThemedText>
          <TextField label={t('jr.name')} value={name} onChangeText={setName} placeholder={t('jr.namePlaceholder')} />

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">{t('su.beltRank')}</ThemedText>
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
                      {t(`belt.${b}`)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">{t('su.dob')}</ThemedText>
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

          <Button label={t('jr.addBtn')} icon="add" loading={busy} onPress={onAdd} />
          <Button label={t('common.cancel')} variant="ghost" onPress={resetForm} />
        </Card>
      ) : (
        <Button label={t('jr.add')} icon="add" variant="secondary" onPress={() => setAdding(true)} />
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
