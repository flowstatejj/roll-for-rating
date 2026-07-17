import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { fetchTeamFixtures, fetchTeamStandings, generateTeamSeason, recordTeamResult } from '@/lib/leagues';
import type { LeagueTeamFixture, LeagueTeamStanding } from '@/lib/types';

/**
 * Team-league season surface: generate the double round-robin, browse weekly
 * team fixtures, record each matchup's score (organizer), and rank teams.
 * Phase 2 records a direct team score; Phase 3 will derive it from sub-bouts.
 */
export function LeagueTeamSeason({ leagueId, isOrganizer, onChanged }: { leagueId: string; isOrganizer: boolean; onChanged?: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [fixtures, setFixtures] = useState<LeagueTeamFixture[]>([]);
  const [standings, setStandings] = useState<LeagueTeamStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [aScore, setAScore] = useState('');
  const [bScore, setBScore] = useState('');

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

  useEffect(() => {
    reload();
  }, [reload]);

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

  function openScore(f: LeagueTeamFixture) {
    setScoringId(f.id);
    // f.a_score/b_score are always numbers; render a real 0 as "0", not blank.
    setAScore(f.status === 'done' ? String(f.a_score) : '');
    setBScore(f.status === 'done' ? String(f.b_score) : '');
  }

  async function saveScore(f: LeagueTeamFixture) {
    const a = parseInt(aScore, 10);
    const b = parseInt(bScore, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) {
      Alert.alert(t('lt.enterScores'));
      return;
    }
    // Close the editor only after a successful save, so a failure keeps the row
    // open with the typed scores.
    await act(async () => {
      await recordTeamResult(f.id, a, b);
      setScoringId(null);
    });
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
            {fixtures.filter((f) => f.week_no === wk).map((f, i) => (
              <View key={f.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={{ paddingVertical: Spacing.two, gap: Spacing.one }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                      {f.status === 'bye'
                        ? `${f.team_a_name ?? '?'} · ${t('le.byeShort')}`
                        : `${f.team_a_name ?? '?'} ${t('le.vs')} ${f.team_b_name ?? '?'}`}
                    </ThemedText>
                    {f.status === 'done' && (
                      <ThemedText style={{ fontWeight: '800' }}>{f.a_score}-{f.b_score}</ThemedText>
                    )}
                    {f.status === 'done' && <Ionicons name="checkmark-circle" size={18} color={theme.success} />}
                    {isOrganizer && f.status !== 'bye' && scoringId !== f.id && (
                      <Button label={f.status === 'done' ? t('lt.edit') : t('lt.record')} variant={f.status === 'done' ? 'ghost' : 'secondary'} onPress={() => openScore(f)} />
                    )}
                  </View>

                  {scoringId === f.id && (
                    <View style={{ gap: Spacing.two }}>
                      <View style={styles.scoreRow}>
                        <View style={{ flex: 1 }}>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{f.team_a_name}</ThemedText>
                          <TextField value={aScore} onChangeText={setAScore} keyboardType="number-pad" placeholder="0" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{f.team_b_name}</ThemedText>
                          <TextField value={bScore} onChangeText={setBScore} keyboardType="number-pad" placeholder="0" />
                        </View>
                      </View>
                      <View style={styles.scoreRow}>
                        <View style={{ flex: 1 }}><Button label={t('common.cancel')} variant="ghost" onPress={() => setScoringId(null)} /></View>
                        <View style={{ flex: 1 }}><Button label={t('lt.save')} icon="checkmark" loading={busy} onPress={() => saveScore(f)} /></View>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            ))}
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
  scoreRow: { flexDirection: 'row', gap: Spacing.two },
});
