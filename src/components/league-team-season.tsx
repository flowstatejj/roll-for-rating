import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { fetchTeamFixtures, fetchTeamStandings, generateTeamSeason } from '@/lib/leagues';
import type { LeagueTeamFixture, LeagueTeamStanding } from '@/lib/types';

/**
 * Team-league season surface: generate the double round-robin, browse weekly
 * team fixtures, and rank teams. Recording a matchup opens the member-vs-member
 * runner (Phase 3), which computes the team score.
 */
export function LeagueTeamSeason({ leagueId, isOrganizer, onChanged }: { leagueId: string; isOrganizer: boolean; onChanged?: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [fixtures, setFixtures] = useState<LeagueTeamFixture[]>([]);
  const [standings, setStandings] = useState<LeagueTeamStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([fetchTeamFixtures(leagueId), fetchTeamStandings(leagueId)]);
      setFixtures(f);
      setStandings(s);
      setLoadError(false);
    } catch (e) {
      console.warn('team season load failed', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  // Reload on focus so scores recorded in the matchup runner show on return.
  useFocusEffect(useCallback(() => {
    reload();
  }, [reload]));

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      onChanged?.();
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function generate() {
    Alert.alert(t('lt.genSeasonTitle'), t('lt.genSeasonBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('lt.generate'),
        onPress: () => act(async () => {
          const r = await generateTeamSeason(leagueId);
          if (!r.ok) throw new Error(r.reason === 'need_2_teams' ? t('lt.need2Teams') : t('md.tryAgain'));
        }),
      },
    ]);
  }

  if (loading) return null;

  if (loadError && fixtures.length === 0) {
    return (
      <>
        <ThemedText style={styles.section}>{t('lt.season')}</ThemedText>
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">{t('md.loadFailed')}</ThemedText>
          <Button label={t('md.tryAgain')} icon="refresh" loading={busy} onPress={() => act(async () => {})} />
        </Card>
      </>
    );
  }

  // No season yet.
  if (fixtures.length === 0) {
    return (
      <>
        <ThemedText style={styles.section}>{t('lt.season')}</ThemedText>
        {isOrganizer ? (
          <Card style={{ gap: Spacing.two }}>
            <ThemedText type="small" themeColor="textSecondary">{t('lt.genSeasonHint')}</ThemedText>
            <Button label={t('lt.generateSeason')} icon="calendar" loading={busy} onPress={generate} />
          </Card>
        ) : (
          <EmptyState icon="calendar-outline" title={t('lt.noSeasonTitle')} subtitle={t('lt.noSeasonSub')} />
        )}
      </>
    );
  }

  const weeks = [...new Set(fixtures.map((f) => f.week_no))].sort((a, b) => a - b);

  return (
    <>
      {/* Standings */}
      <ThemedText style={styles.section}>{t('lt.standings')}</ThemedText>
      <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
        {standings.map((s, i) => {
          const medal = i === 0 ? '#E5B53A' : i === 1 ? '#A7AAB0' : i === 2 ? '#B07A45' : null;
          return (
            <View key={s.team_id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <View style={styles.standRow}>
                <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                  <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>{i + 1}</ThemedText>
                </View>
                <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{s.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {s.wins}{t('lb.w')} · {s.losses}{t('lb.l')} · {s.draws}{t('lb.d')}
                </ThemedText>
                <ThemedText style={{ width: 36, textAlign: 'right', fontWeight: '800', fontSize: 16 }}>{s.points}</ThemedText>
              </View>
            </View>
          );
        })}
      </Card>

      {/* Fixtures by week */}
      <ThemedText style={styles.section}>{t('lt.schedule')}</ThemedText>
      {weeks.map((wk) => (
        <View key={wk} style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t('le.week')} {wk}</ThemedText>
          <Card style={{ paddingVertical: Spacing.one }}>
            {fixtures.filter((f) => f.week_no === wk).map((f, i) => {
              const inProgress = f.status === 'pending' && (f.sub_count ?? 0) > 0;
              return (
              <View key={f.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={{ paddingVertical: Spacing.two, gap: Spacing.one }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                      {f.status === 'bye'
                        ? `${f.team_a_name ?? '?'} · ${t('le.byeShort')}`
                        : `${f.team_a_name ?? '?'} ${t('le.vs')} ${f.team_b_name ?? '?'}`}
                    </ThemedText>
                    {(f.status === 'done' || inProgress) && (
                      <ThemedText style={{ fontWeight: '800' }}>{f.a_score}-{f.b_score}</ThemedText>
                    )}
                    {f.status === 'done' && <Ionicons name="checkmark-circle" size={18} color={theme.success} />}
                    {inProgress && <Ionicons name="ellipse" size={10} color={theme.accent} />}
                    {f.status !== 'bye' && (
                      <Button
                        label={f.status === 'done' ? (isOrganizer ? t('lt.edit') : t('lt.view')) : !isOrganizer ? t('lt.view') : inProgress ? t('lt.continue') : t('lt.record')}
                        variant={f.status === 'done' ? 'ghost' : 'secondary'}
                        onPress={() => router.push(`/league/matchup/${f.id}`)}
                      />
                    )}
                  </View>
                </View>
              </View>
            ); })}
          </Card>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
  standRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
