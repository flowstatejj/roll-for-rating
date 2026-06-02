import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  fetchEntrants,
  fetchTournament,
  fetchTournamentStandings,
  joinTournament,
  leaveTournament,
} from '@/lib/tournaments';
import type { Tournament, TournamentStanding } from '@/lib/types';

export default function TournamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const { t: tr } = useTranslation();
  const userId = session!.user.id;

  const [t, setT] = useState<Tournament | null>(null);
  const [entrants, setEntrants] = useState<string[]>([]);
  const [standings, setStandings] = useState<TournamentStanding[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [tt, ee, ss] = await Promise.all([fetchTournament(id), fetchEntrants(id), fetchTournamentStandings(id)]);
      setT(tt);
      setEntrants(ee);
      setStandings(ss);
    } catch (e) {
      console.warn('tournament load failed', e);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!t) return <Loading />;

  const now = Date.now();
  const ended = now > new Date(t.ends_at).getTime();
  const live = !ended && now >= new Date(t.starts_at).getTime();
  const joined = entrants.includes(userId);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e: any) {
      Alert.alert(tr('md.error'), e.message ?? tr('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t.name }} />

      <Card style={{ gap: Spacing.one }}>
        <ThemedText style={{ fontSize: 22, fontWeight: '800' }}>{t.name}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {new Date(t.starts_at).toLocaleDateString()} – {new Date(t.ends_at).toLocaleDateString()} ·{' '}
          {ended ? tr('tr.ended') : live ? tr('td.liveNow') : tr('tr.upcoming')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {entrants.length} {entrants.length === 1 ? tr('td.entrant') : tr('td.entrants')} · {tr('td.scoreNote')}
        </ThemedText>
      </Card>

      {!ended &&
        (joined ? (
          <Button label={tr('td.leave')} variant="ghost" icon="exit-outline" loading={busy} onPress={() => act(() => leaveTournament(t.id, userId))} />
        ) : (
          <Button label={tr('td.join')} icon="add-circle" loading={busy} onPress={() => act(() => joinTournament(t.id, userId))} />
        ))}

      <ThemedText style={styles.section}>{tr('se.standings')}</ThemedText>
      {standings.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <ThemedText themeColor="textSecondary">{tr('td.noEntrants')}</ThemedText>
        </Card>
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {standings.map((s, i) => {
            const isMe = s.user_id === userId;
            const medal = i === 0 ? '#E5B53A' : i === 1 ? '#A7AAB0' : i === 2 ? '#B07A45' : null;
            return (
              <View key={s.user_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                  <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                    <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>{i + 1}</ThemedText>
                  </View>
                  <Avatar name={s.display_name} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                      {s.display_name}
                      {isMe ? ` ${tr('md.you')}` : ''}
                    </ThemedText>
                    <BeltChip belt={s.belt_rank} size="sm" />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{s.wins}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{tr('gr.wins')}</ThemedText>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
