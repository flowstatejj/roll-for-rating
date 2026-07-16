import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { MatchTimer } from '@/components/match-timer';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { recordBout, recordSubbout } from '@/lib/tournaments';
import type { ResultType } from '@/lib/types';

type Roster = { user_id: string; slot: number | null; display_name: string }[];

export default function BoutRunnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [bout, setBout] = useState<any>(null);
  const [teamRule, setTeamRule] = useState<'none' | 'duel' | 'quintet'>('none');
  const [teamSize, setTeamSize] = useState(1);
  // In an elimination bracket a draw advances no one and permanently dead-ends
  // the line (the finished-bout guard blocks re-recording), so hide Draw there.
  const [isElim, setIsElim] = useState(false);
  const [aName, setAName] = useState('?');
  const [bName, setBName] = useState('?');
  const [aRoster, setARoster] = useState<Roster>([]);
  const [bRoster, setBRoster] = useState<Roster>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [winner, setWinner] = useState<'a' | 'b' | 'draw' | null>(null);
  const [method, setMethod] = useState<'submission' | 'points' | 'decision'>('submission');
  const [subCat, setSubCat] = useState<'kill' | 'break' | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: b } = await supabase.from('tournament_bouts').select('*').eq('id', id).single();
      setBout(b);
      if (!b) return;
      const { data: trow } = await supabase.from('tournaments').select('team_rule, team_size, format').eq('id', b.tournament_id).single();
      setTeamRule((trow?.team_rule ?? 'none') as any);
      setTeamSize(trow?.team_size ?? 1);
      let fmt: string | null = trow?.format ?? null;
      if (b.division_id) {
        const { data: drow } = await supabase.from('tournament_divisions').select('format').eq('id', b.division_id).maybeSingle();
        fmt = drow?.format ?? fmt; // division format inherits the tournament's when null
      }
      setIsElim(fmt === 'single_elim' || fmt === 'double_elim');
      if (b.a_team || b.b_team) {
        const load1 = async (teamId: string | null) => {
          if (!teamId) return [];
          const { data } = await supabase
            .from('tournament_team_members')
            .select('user_id, slot, profile:profiles(display_name)')
            .eq('team_id', teamId);
          return (data ?? [])
            .map((m: any) => ({ user_id: m.user_id, slot: m.slot, display_name: m.profile?.display_name ?? '?' }))
            .sort((x: any, y: any) => (x.slot ?? 999) - (y.slot ?? 999));
        };
        const [ar, br] = await Promise.all([load1(b.a_team), load1(b.b_team)]);
        setARoster(ar); setBRoster(br);
        const { data: ta } = await supabase.from('tournament_teams').select('name').eq('id', b.a_team).maybeSingle();
        const { data: tb } = await supabase.from('tournament_teams').select('name').eq('id', b.b_team).maybeSingle();
        setAName(ta?.name ?? '?'); setBName(tb?.name ?? '?');
      } else {
        const ids = [b.a_entrant, b.b_entrant].filter(Boolean);
        const { data: ps } = await supabase.from('profiles').select('id, display_name').in('id', ids);
        const m = new Map((ps ?? []).map((p: any) => [p.id, p.display_name]));
        setAName(m.get(b.a_entrant) ?? '?'); setBName(m.get(b.b_entrant) ?? '?');
      }
    } catch (e) {
      console.warn('bout load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;
  if (!bout) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <Card><ThemedText>{t('tn.boutNotFound')}</ThemedText></Card>
      </Screen>
    );
  }

  const isTeam = !!(bout.a_team || bout.b_team);
  const done = bout.status === 'done';

  // current fighters for a team bout
  const aFighter = aRoster[(bout.a_idx ?? 1) - 1];
  const bFighter = bRoster[(bout.b_idx ?? 1) - 1];

  async function submit() {
    if (!winner) { Alert.alert(t('md.incomplete'), t('md.pickWinner')); return; }
    const result: ResultType = winner === 'draw' ? 'draw' : (method as ResultType);
    const sub = winner !== 'draw' && method === 'submission' ? subCat : null;
    setBusy(true);
    try {
      if (isTeam) {
        await recordSubbout({ boutId: id, winner, result, subCategory: sub });
        setWinner(null); setSubCat(null);
        await load(); // show next fighters or completion
      } else {
        await recordBout({ boutId: id, winner, result, subCategory: sub });
        router.back();
      }
    } catch (e: any) {
      Alert.alert(t('tn.recordFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('tn.record') }} />

      {!done && <MatchTimer matchId={`bout:${id}`} canControl />}

      <Card style={{ gap: Spacing.one }}>
        <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{aName} {t('le.vs')} {bName}</ThemedText>
        {isTeam && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {t('tn.score')}: {bout.a_score}–{bout.b_score} · {teamRule === 'quintet' ? t('tn.rule.quintet') : t('tn.rule.duel')}
            </ThemedText>
            {!done && (
              <ThemedText style={{ fontWeight: '700' }}>
                {t('tn.nowFighting')}: {aFighter?.display_name ?? '—'} {t('le.vs')} {bFighter?.display_name ?? '—'}
              </ThemedText>
            )}
          </>
        )}
      </Card>

      {done ? (
        <Card style={{ alignItems: 'center', gap: Spacing.two }}>
          <ThemedText style={{ fontWeight: '800' }}>
            {bout.winner === 'draw' ? t('md.drawChoice') : `${bout.winner === 'a' ? aName : bName} ${t('md.won')}`}
          </ThemedText>
          <Button label={t('tn.back')} variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : (
        <Card style={{ gap: Spacing.three }}>
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">{t('tn.winner')}</ThemedText>
            <View style={styles.chips}>
              <Choice label={isTeam ? (aFighter?.display_name ?? aName) : aName} active={winner === 'a'} onPress={() => setWinner('a')} />
              <Choice label={isTeam ? (bFighter?.display_name ?? bName) : bName} active={winner === 'b'} onPress={() => setWinner('b')} />
              {/* Team sub-bout draws are legal (quintet: both fighters out); only
                  individual elimination bouts must always produce an advancer. */}
              {(isTeam || !isElim) && <Choice label={t('md.drawChoice')} active={winner === 'draw'} onPress={() => setWinner('draw')} />}
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

          <Button label={isTeam ? t('tn.recordSub') : t('tn.recordResult')} icon="trophy" onPress={submit} loading={busy} />
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
});
