import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { createOpenMat, deleteOpenMat, fetchOpenMats } from '@/lib/social';
import type { OpenMat } from '@/lib/types';

export default function OpenMatsScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [query, setQuery] = useState('');
  const [mats, setMats] = useState<OpenMat[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', city: '', address: '', schedule: '', notes: '' });

  const load = useCallback(async () => {
    try {
      setMats(await fetchOpenMats(query));
    } catch (e) {
      console.warn('load open mats failed', e);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    if (!form.title.trim()) {
      Alert.alert(t('om.titleReqTitle'), t('om.titleReqBody'));
      return;
    }
    setBusy(true);
    try {
      await createOpenMat({
        createdBy: userId,
        title: form.title,
        city: form.city,
        address: form.address,
        schedule: form.schedule,
        notes: form.notes,
        gymId: profile?.gym_id ?? null,
      });
      setForm({ title: '', city: '', address: '', schedule: '', notes: '' });
      setAdding(false);
      await load();
    } catch (e: any) {
      Alert.alert(t('om.postFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(id: string) {
    Alert.alert(t('om.removeTitle'), t('om.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('om.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOpenMat(id);
            await load();
          } catch (e: any) {
            Alert.alert(t('om.deleteFail'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.openMats') }} />

      {adding ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>{t('om.post')}</ThemedText>
          <TextField label={t('om.title')} value={form.title} onChangeText={(v) => set('title', v)} placeholder="Saturday Open Mat" />
          <TextField label={t('om.city')} value={form.city} onChangeText={(v) => set('city', v)} placeholder="Springfield" />
          <TextField label={t('om.address')} value={form.address} onChangeText={(v) => set('address', v)} placeholder="123 Main St" />
          <TextField label={t('om.when')} value={form.schedule} onChangeText={(v) => set('schedule', v)} placeholder="Saturdays 11:00 AM" />
          <TextField label={t('md.notes')} value={form.notes} onChangeText={(v) => set('notes', v)} multiline placeholder="All levels welcome, $10 drop-in" />
          <Button label={t('om.postBtn')} icon="megaphone" loading={busy} onPress={submit} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button label={t('om.post')} icon="megaphone" onPress={() => setAdding(true)} />
      )}

      <TextField label={t('om.search')} value={query} onChangeText={setQuery} autoCapitalize="none" placeholder={t('om.searchPlaceholder')} />

      {mats.length === 0 ? (
        <EmptyState icon="calendar-outline" title={t('om.emptyTitle')} subtitle={t('om.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {mats.map((m) => (
            <Card key={m.id} style={{ gap: Spacing.one }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ThemedText style={{ fontSize: 16, fontWeight: '800', flex: 1 }}>{m.title}</ThemedText>
                {m.created_by === userId && (
                  <Pressable onPress={() => confirmDelete(m.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={theme.danger} />
                  </Pressable>
                )}
              </View>
              {m.schedule ? (
                <Row icon="time-outline" text={m.schedule} />
              ) : null}
              {(m.city || m.address) ? (
                <Row icon="location-outline" text={[m.city, m.address].filter(Boolean).join(' · ')} />
              ) : null}
              {m.notes ? <ThemedText themeColor="textSecondary">{m.notes}</ThemedText> : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={15} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
