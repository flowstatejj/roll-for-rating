import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { createTournament, fetchTournaments } from '@/lib/tournaments';
import type { Tournament } from '@/lib/types';

const DURATIONS = [
  { tkey: 'tr.dur1w', days: 7 },
  { tkey: 'tr.dur2w', days: 14 },
  { tkey: 'tr.dur1m', days: 30 },
];

function status(t: Tournament): { tkey: string; color: string } {
  const now = Date.now();
  const s = new Date(t.starts_at).getTime();
  const e = new Date(t.ends_at).getTime();
  if (now < s) return { tkey: 'tr.upcoming', color: '#D9822B' };
  if (now > e) return { tkey: 'tr.ended', color: '#9aa2ad' };
  return { tkey: 'tr.live', color: '#5c9a3a' };
}

export default function TournamentsScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
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
      Alert.alert(t('tr.nameReqTitle'), t('tr.nameReqBody'));
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
      Alert.alert(t('tr.createFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.tournaments') }} />
      <ThemedText themeColor="textSecondary">
        {t('tr.intro')}
      </ThemedText>

      {creating ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>{t('tr.newTitle')}</ThemedText>
          <TextField label={t('tr.name')} value={name} onChangeText={setName} placeholder="Spring Throwdown" />
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">{t('tr.runsFor')}</ThemedText>
            <View style={styles.chips}>
              {DURATIONS.map((d) => {
                const active = days === d.days;
                return (
                  <Pressable
                    key={d.days}
                    onPress={() => setDays(d.days)}
                    style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
                    <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>{t(d.tkey)}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Button label={t('tr.createBtn')} icon="trophy" loading={busy} onPress={submit} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label={t('tr.create')} icon="trophy" onPress={() => setCreating(true)} />
      )}

      {items.length === 0 ? (
        <EmptyState icon="trophy-outline" title={t('tr.emptyTitle')} subtitle={t('tr.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {items.map((ev) => {
            const st = status(ev);
            return (
              <Pressable key={ev.id} onPress={() => router.push(`/tournament/${ev.id}`)}>
                <Card style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                    <Ionicons name="trophy" size={20} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{ev.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(ev.starts_at).toLocaleDateString()} – {new Date(ev.ends_at).toLocaleDateString()}
                    </ThemedText>
                  </View>
                  <View style={[styles.badge, { backgroundColor: st.color + '22' }]}>
                    <ThemedText style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{t(st.tkey)}</ThemedText>
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
