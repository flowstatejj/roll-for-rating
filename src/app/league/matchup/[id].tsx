import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { MatchTimer } from '@/components/match-timer';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchTeamSubbouts, recordLeagueTeamSubbout, recordTeamResult, resetTeamMatchup } from '@/lib/leagues';
import { supabase } from '@/lib/supabase';
import type { LeagueTeamSubbout, ResultType } from '@/lib/types';

type Roster = { user_id: string; slot: number | null; display_name: string }[];

/**
 * League team-matchup runner: record the member-vs-member matches that make up a
 * team fixture. Duel (2v2/3v3) pairs slot N vs slot N; quintet (5v5) is a
 * winner-stays survivor run. The server computes the team score and closes the
 * fixture; the organizer can also enter a final score directly or reset.
 */
export default function LeagueMatchupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [fixture, setFixture] = useState<any>(null);
  const [teamRule, setTeamRule] = useState<'none' | 'duel' | 'quintet'>('duel');
  const [teamSize, setTeamSize] = useState(2);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [aName, setAName] = useState('?');
  const [bName, setBName] = useState('?');
  const [aRoster, setARoster] = useState<Roster>([]);
  const [bRoster, setBRoster] = useState<Roster>([]);
  const [subbouts, setSubbouts] = useState<LeagueTeamSubbout[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [winner, setWinner] = useState<'a' | 'b' | 'draw' | null>(null);
  const [method, setMethod] = useState<'submission' | 'points' | 'decision'>('submission');
  const [subCat, setSubCat] = useState<'kill' | 'break' | null>(null);
  const [quick, setQuick] = useState(false);
  const [aScore, setAScore] = useState('');
  const [bScore, setBScore] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: f } = await supabase.from('league_team_fixtures').select('*').eq('id', id).single();
      setFixture(f);
      if (!f) return;
      const { data: lg } = await supabase.from('leagues').select('team_rule, team_size, created_by').eq('id', f.league_id).single();
      setTeamRule((lg?.team_rule ?? 'duel') as any);
      setTeamSize(lg?.team_size ?? 2);
      setIsOrganizer(lg?.created_by === userId);

      const load1 = async (teamId: string | null): Promise<Roster> => {
        if (!teamId) return [];
        const { data } = await supabase
          .from('league_team_members')
          .select('user_id, slot, profile:profiles(display_name)')
          .eq('team_id', teamId);
        return (data ?? [])
          .map((m: any) => ({ user_id: m.user_id, slot: m.slot, display_name: m.profile?.display_name ?? '?' }))
          .sort((x, y) => (x.slot ?? 999) - (y.slot ?? 999));
      };
      const [ar, br] = await Promise.all([load1(f.team_a), load1(f.team_b)]);
      setARoster(ar);
      setBRoster(br);
      const { data: ta } = await supabase.from('league_teams').select('name').eq('id', f.team_a).maybeSingle();
      const { data: tb } = await supabase.from('league_teams').select('name').eq('id', f.team_b).maybeSingle();
      setAName(ta?.name ?? '?');
      setBName(tb?.name ?? '?');
      setSubbouts(await fetchTeamSubbouts(id));
    } catch (e) {
      console.warn('matchup load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;
  if (!fixture) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <Card><ThemedText>{t('lt.matchupNotFound')}</ThemedText></Card>
      </Screen>
    );
  }

  const done = fixture.status === 'done';
  const aIdx = fixture.a_idx ?? 1;
  const bIdx = fixture.b_idx ?? 1;
  const aFighter = aRoster[aIdx - 1];
  const bFighter = bRoster[bIdx - 1];
  // Match-by-match scoring needs a full roster on both sides (a short team would
  // stall a duel and can't be swept cleanly); short teams use the quick-score path.
  const rostersFull = aRoster.length >= teamSize && bRoster.length >= teamSize;

  async function submitSub() {
    if (busy) return;
    if (!winner) { Alert.alert(t('md.incomplete'), t('md.pickWinner')); return; }
    const result: ResultType = winner === 'draw' ? 'draw' : (method as ResultType);
    const sub = winner !== 'draw' && method === 'submission' ? subCat : null;
    setBusy(true);
    try {
      await recordLeagueTeamSubbout({ fixtureId: id, winner, result, subCategory: sub });
      setWinner(null); setSubCat(null); setMethod('submission');
      await load();
    } catch (e: any) {
      Alert.alert(t('tn.recordFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  async function saveQuick() {
    if (busy) return;
    const a = parseInt(aScore, 10);
    const b = parseInt(bScore, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) { Alert.alert(t('lt.enterScores')); return; }
    setBusy(true);
    try {
      await recordTeamResult(id, a, b);
      setQuick(false); setAScore(''); setBScore('');
      await load();
    } catch (e: any) {
      Alert.alert(t('tn.recordFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmReset() {
    Alert.alert(t('lt.resetTitle'), t('lt.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('lt.reset'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try { await resetTeamMatchup(id); await load(); }
          catch (e: any) { Alert.alert(t('tn.recordFail'), e.message ?? t('md.tryAgain')); }
          finally { setBusy(false); }
        },
      },
    ]);
  }

  const winnerName = fixture.winner === 'a' ? aName : fixture.winner === 'b' ? bName : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('lt.matchup') }} />

      {!done && rostersFull && <MatchTimer matchId={`ltf:${id}`} canControl />}

      <Card style={{ gap: Spacing.one }}>
        <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{aName} {t('le.vs')} {bName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('tn.score')}: {fixture.a_score}-{fixture.b_score} · {teamRule === 'quintet' ? t('tn.rule.quintet') : t('tn.rule.duel')}
        </ThemedText>
        {!done && rostersFull && (
          <ThemedText style={{ fontWeight: '700' }}>
            {t('tn.nowFighting')}: {aFighter?.display_name ?? '?'} {t('le.vs')} {bFighter?.display_name ?? '?'}
          </ThemedText>
        )}
      </Card>

      {/* Recorded matches so far */}
      {subbouts.length > 0 && (
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t('lt.matches')}</ThemedText>
          {subbouts.map((s) => (
            <View key={s.id} style={styles.subRow}>
              <ThemedText type="small" themeColor="textSecondary" style={{ width: 24 }}>{s.order_no}</ThemedText>
              <ThemedText type="small" style={{ flex: 1, fontWeight: s.winner === 'a' ? '800' : '500' }} numberOfLines={1}>{s.a_name ?? '?'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('le.vs')}</ThemedText>
              <ThemedText type="small" style={{ flex: 1, textAlign: 'right', fontWeight: s.winner === 'b' ? '800' : '500' }} numberOfLines={1}>{s.b_name ?? '?'}</ThemedText>
            </View>
          ))}
        </Card>
      )}

      {done ? (
        <Card style={{ alignItems: 'center', gap: Spacing.two }}>
          <Ionicons name="trophy" size={28} color={theme.accent} />
          <ThemedText style={{ fontWeight: '800' }}>
            {winnerName ? `${winnerName} ${t('md.won')}` : t('md.drawChoice')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{fixture.a_score}-{fixture.b_score}</ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            {isOrganizer && <Button label={t('lt.reset')} variant="ghost" icon="refresh" loading={busy} onPress={confirmReset} />}
            <Button label={t('tn.back')} variant="secondary" onPress={() => router.back()} />
          </View>
        </Card>
      ) : !isOrganizer ? (
        <Card><ThemedText type="small" themeColor="textSecondary">{t('lt.organizerRecords')}</ThemedText></Card>
      ) : quick ? (
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold" themeColor="textSecondary">{t('lt.quickScore')}</ThemedText>
          <View style={styles.scoreRow}>
            <View style={{ flex: 1 }}>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{aName}</ThemedText>
              <TextField value={aScore} onChangeText={setAScore} keyboardType="number-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{bName}</ThemedText>
              <TextField value={bScore} onChangeText={setBScore} keyboardType="number-pad" placeholder="0" />
            </View>
          </View>
          <View style={styles.scoreRow}>
            <View style={{ flex: 1 }}><Button label={t('common.cancel')} variant="ghost" onPress={() => setQuick(false)} /></View>
            <View style={{ flex: 1 }}><Button label={t('lt.save')} icon="checkmark" loading={busy} onPress={saveQuick} /></View>
          </View>
        </Card>
      ) : !rostersFull ? (
        <Card style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">{t('lt.rosterNeeded')}</ThemedText>
          <Button label={t('lt.quickScore')} variant="secondary" onPress={() => setQuick(true)} />
        </Card>
      ) : (
        <Card style={{ gap: Spacing.three }}>
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">{t('tn.winner')}</ThemedText>
            <View style={styles.chips}>
              <Choice label={aFighter?.display_name ?? aName} active={winner === 'a'} onPress={() => setWinner('a')} />
              <Choice label={bFighter?.display_name ?? bName} active={winner === 'b'} onPress={() => setWinner('b')} />
              <Choice label={t('md.drawChoice')} active={winner === 'draw'} onPress={() => setWinner('draw')} />
            </View>
          </View>

          {winner && winner !== 'draw' && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('tn.method')}</ThemedText>
              <View style={styles.chips}>
                <Choice label={t('tn.bySub')} active={method === 'submission'} onPress={() => setMethod('submission')} />
                <Choice label={t('tn.byPoints')} active={method === 'points'} onPress={() => setMethod('points')} />
                <Choice label={t('tn.byDecision')} active={method === 'decision'} onPress={() => setMethod('decision')} />
              </View>
            </View>
          )}

          {winner && winner !== 'draw' && method === 'submission' && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('md.subKind')}</ThemedText>
              <View style={styles.chips}>
                <Choice label={t('md.kill')} active={subCat === 'kill'} onPress={() => setSubCat(subCat === 'kill' ? null : 'kill')} />
                <Choice label={t('md.break')} active={subCat === 'break'} onPress={() => setSubCat(subCat === 'break' ? null : 'break')} />
              </View>
            </View>
          )}

          <Button label={t('lt.recordMatch')} icon="add-circle" onPress={submitSub} loading={busy} />
          {subbouts.length === 0 && (
            <Button label={t('lt.quickScore')} variant="ghost" onPress={() => setQuick(true)} />
          )}
          {subbouts.length > 0 && (
            <Button label={t('lt.reset')} variant="ghost" icon="refresh" loading={busy} onPress={confirmReset} />
          )}
        </Card>
      )}
    </Screen>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  scoreRow: { flexDirection: 'row', gap: Spacing.two },
});
