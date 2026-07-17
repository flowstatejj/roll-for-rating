import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { fetchTeamFixtures, fetchTeamPlayoff, generateTeamPlayoff } from '@/lib/leagues';
import type { LeagueTeamFixture } from '@/lib/types';

/**
 * Team-league playoff surface: the organizer seeds the top teams into a single-
 * elimination bracket after the season; each matchup opens the same member-vs-
 * member runner, and winners advance automatically. Phase 4.
 */
export function LeagueTeamPlayoff({ leagueId, isOrganizer, onChanged }: { leagueId: string; isOrganizer: boolean; onChanged?: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [bracket, setBracket] = useState<LeagueTeamFixture[]>([]);
  const [seasonComplete, setSeasonComplete] = useState(false);
  const [hasSeason, setHasSeason] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [pf, season] = await Promise.all([fetchTeamPlayoff(leagueId), fetchTeamFixtures(leagueId)]);
      setBracket(pf);
      setHasSeason(season.length > 0);
      // "Complete" once every real (non-bye) season matchup is recorded.
      const playable = season.filter((f) => f.status !== 'bye');
      setSeasonComplete(playable.length > 0 && playable.every((f) => f.status === 'done'));
      setLoadError(false);
    } catch (e) {
      console.warn('playoff load failed', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  // Reload on focus so the bracket reflects a matchup just recorded in the runner.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

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
    const body = seasonComplete ? t('lt.genPlayoffBody') : t('lt.genPlayoffBodyIncomplete');
    Alert.alert(t('lt.genPlayoffTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('lt.generatePlayoff'),
        onPress: () => act(async () => {
          const r = await generateTeamPlayoff(leagueId, 8);
          if (!r.ok) throw new Error(r.reason === 'need_2_teams' ? t('lt.need2Teams') : t('md.tryAgain'));
        }),
      },
    ]);
  }

  if (loading) return null;

  // A failed fetch must not silently hide the surface; show a retry.
  if (loadError && bracket.length === 0) {
    return (
      <>
        <ThemedText style={styles.section}>{t('lt.playoff')}</ThemedText>
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">{t('md.loadFailed')}</ThemedText>
          <Button label={t('md.tryAgain')} icon="refresh" loading={busy} onPress={() => act(async () => {})} />
        </Card>
      </>
    );
  }

  // Only relevant once a season exists (teams + fixtures).
  if (!hasSeason && bracket.length === 0) return null;

  const maxRound = bracket.reduce((m, f) => Math.max(m, f.round_no ?? 0), 0);
  const roundLabel = (r: number) =>
    r === maxRound ? t('lt.final') : r === maxRound - 1 ? t('lt.semis') : r === maxRound - 2 ? t('lt.quarters') : `${t('tn.round')} ${r}`;

  // Champion: the final fixture, resolved by winner (or better seed on a draw).
  const finalFx = bracket.find((f) => f.round_no === maxRound);
  let champion: string | null = null;
  if (finalFx && finalFx.status === 'done') {
    if (finalFx.winner === 'a') champion = finalFx.team_a_name;
    else if (finalFx.winner === 'b') champion = finalFx.team_b_name;
    else {
      const sa = finalFx.team_a_seed ?? 9999;
      const sb = finalFx.team_b_seed ?? 9999;
      champion = sa <= sb ? finalFx.team_a_name : finalFx.team_b_name;
    }
  }

  const rounds = [...new Set(bracket.map((f) => f.round_no ?? 0))].sort((a, b) => a - b);

  return (
    <>
      <ThemedText style={styles.section}>{t('lt.playoff')}</ThemedText>

      {bracket.length === 0 ? (
        isOrganizer ? (
          <Card style={{ gap: Spacing.two }}>
            <ThemedText type="small" themeColor="textSecondary">
              {seasonComplete ? t('lt.genPlayoffHint') : t('lt.seasonIncomplete')}
            </ThemedText>
            <Button label={t('lt.generatePlayoff')} icon="trophy" loading={busy} onPress={generate} />
          </Card>
        ) : (
          <EmptyState icon="trophy-outline" title={t('lt.noPlayoffTitle')} subtitle={t('lt.noPlayoffSub')} />
        )
      ) : (
        <>
          {champion && (
            <Card style={{ alignItems: 'center', gap: Spacing.one, borderColor: theme.accent, borderWidth: 1 }}>
              <Ionicons name="trophy" size={26} color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary">{t('lt.champion')}</ThemedText>
              <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{champion}</ThemedText>
            </Card>
          )}

          {rounds.map((rd) => (
            <View key={rd} style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{roundLabel(rd)}</ThemedText>
              <Card style={{ paddingVertical: Spacing.one }}>
                {bracket.filter((f) => (f.round_no ?? 0) === rd).map((f, i) => {
                  const ready = !!f.team_a && !!f.team_b;
                  const inProgress = f.status === 'pending' && (f.sub_count ?? 0) > 0;
                  const nameA = f.team_a_name ? `${f.team_a_seed ? f.team_a_seed + '. ' : ''}${f.team_a_name}` : t('tn.tbd');
                  const nameB = f.team_b_name ? `${f.team_b_seed ? f.team_b_seed + '. ' : ''}${f.team_b_name}` : t('tn.tbd');
                  return (
                    <View key={f.id}>
                      {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                      <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={{ fontWeight: f.winner === 'a' ? '800' : '600' }} numberOfLines={1}>
                            {f.status === 'bye' ? `${nameA} · ${t('le.byeShort')}` : nameA}
                          </ThemedText>
                          {f.status !== 'bye' && (
                            <ThemedText style={{ fontWeight: f.winner === 'b' ? '800' : '600' }} numberOfLines={1}>{nameB}</ThemedText>
                          )}
                        </View>
                        {(f.status === 'done' || inProgress) && (
                          <ThemedText style={{ fontWeight: '800' }}>{f.a_score}-{f.b_score}</ThemedText>
                        )}
                        {f.status === 'done' && <Ionicons name="checkmark-circle" size={18} color={theme.success} />}
                        {inProgress && <Ionicons name="ellipse" size={10} color={theme.accent} />}
                        {ready && f.status !== 'bye' && (
                          <Button
                            label={f.status === 'done' ? (isOrganizer ? t('lt.edit') : t('lt.view')) : !isOrganizer ? t('lt.view') : inProgress ? t('lt.continue') : t('lt.record')}
                            variant={f.status === 'done' ? 'ghost' : 'secondary'}
                            onPress={() => router.push(`/league/matchup/${f.id}`)}
                          />
                        )}
                      </View>
                    </View>
                  );
                })}
              </Card>
            </View>
          ))}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
});
