import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { createTournament, fetchMyTournamentInvites, fetchTournaments, respondTournamentInvite, RULESET_PRESETS, type TournamentInvite } from '@/lib/tournaments';
import type { Tournament, TournamentFormat, TournamentRulesetPreset, TournamentScoring, TournamentTeamBuild, TournamentTeamRule } from '@/lib/types';

// Parse a signed integer from a text box (blank / "-" / junk -> 0).
const intval = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
};
const FORMATS: TournamentFormat[] = ['single_elim', 'round_robin', 'double_elim', 'rr_playoff'];
const RULESETS: TournamentRulesetPreset[] = ['ibjjf', 'naga', 'grappling_industries', 'adcc', 'custom'];
const SCORINGS: TournamentScoring[] = ['points', 'submission_only'];

export default function TournamentsScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [items, setItems] = useState<Tournament[]>([]);
  const [invites, setInvites] = useState<TournamentInvite[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cityQ, setCityQ] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const cityRef = useRef('');

  // form
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [city, setCity] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('single_elim');
  const [teamSize, setTeamSize] = useState(1);
  const [teamRule, setTeamRule] = useState<TournamentTeamRule>('none');
  const [teamBuild, setTeamBuild] = useState<TournamentTeamBuild>('host');
  const [ranked, setRanked] = useState(false);
  const [advScoring, setAdvScoring] = useState(false);
  const [winPts, setWinPts] = useState('3');
  const [drawPts, setDrawPts] = useState('1');
  const [lossPts, setLossPts] = useState('0');
  const [killBonus, setKillBonus] = useState('0');
  const [breakBonus, setBreakBonus] = useState('0');
  const [mats, setMats] = useState('1');
  const [scoring, setScoring] = useState<TournamentScoring>('points');
  const [rulesetPreset, setRulesetPreset] = useState<TournamentRulesetPreset>('custom');

  // Picking a federation seeds the scoring defaults; 'custom' leaves them alone.
  function applyPreset(p: TournamentRulesetPreset) {
    setRulesetPreset(p);
    if (p === 'custom') return;
    const d = RULESET_PRESETS[p];
    setScoring(d.scoring);
    setWinPts(String(d.winPoints));
    setDrawPts(String(d.drawPoints));
    setLossPts(String(d.lossPoints));
    setKillBonus(String(d.subKillBonus));
    setBreakBonus(String(d.subBreakBonus));
    if (d.subKillBonus || d.subBreakBonus) setAdvScoring(true);
  }

  const load = useCallback(async () => {
    try {
      const [list, inv] = await Promise.all([fetchTournaments({ city: cityRef.current }), fetchMyTournamentInvites().catch(() => [])]);
      setItems(list);
      setInvites(inv);
    } catch (e) {
      console.warn('tournaments load failed', e);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Debounced re-fetch as the location filter changes.
  useEffect(() => {
    cityRef.current = cityQ;
    const h = setTimeout(load, 300);
    return () => clearTimeout(h);
  }, [cityQ, load]);

  async function respondInvite(tid: string, accept: boolean) {
    setBusy(true);
    try {
      await respondTournamentInvite(tid, accept);
      await load();
      if (accept) router.push(`/tournament/${tid}`);
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function pickSize(sz: number) {
    setTeamSize(sz);
    if (sz === 1) setTeamRule('none');
    else if (teamRule === 'none') setTeamRule(sz === 5 ? 'quintet' : 'duel');
  }

  async function submit() {
    if (!name.trim()) {
      Alert.alert(t('tn.name'), t('tn.nameReq'));
      return;
    }
    setBusy(true);
    try {
      const id = await createTournament({
        name,
        hostId: userId,
        description: desc,
        format,
        teamSize,
        teamRule,
        teamBuild,
        ranked,
        winPoints: intval(winPts),
        drawPoints: intval(drawPts),
        lossPoints: intval(lossPts),
        subKillBonus: intval(killBonus),
        subBreakBonus: intval(breakBonus),
        mats: Math.max(1, Math.min(20, parseInt(mats, 10) || 1)),
        visibility: 'open',
        city,
        scoring,
        rulesetPreset,
      });
      setCreating(false);
      setName(''); setDesc(''); setCity('');
      router.push(`/tournament/${id}`);
    } catch (e: any) {
      Alert.alert(t('tn.createFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  const open = items.filter((tr) => tr.status !== 'complete');
  const completed = items.filter((tr) => tr.status === 'complete');

  // One slim row per tournament, shared by the open and completed sections.
  const renderRow = (tr: Tournament, i: number) => (
    <View key={tr.id}>
      {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
      <Pressable onPress={() => router.push(`/tournament/${tr.id}`)} style={styles.row}>
        <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name="trophy" size={18} color={theme.text} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{tr.name}</ThemedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one }}>
            <Tag text={t(`tn.fmt.${tr.format}`)} tint={theme.textSecondary} />
            <Tag text={tr.team_rule === 'none' ? t('tn.individual') : `${tr.team_size}v${tr.team_size}`} tint={theme.textSecondary} />
            <Tag text={tr.ranked ? t('tn.rankedChip') : t('tn.casualChip')} tint={tr.ranked ? theme.accent : theme.textSecondary} />
            <Tag text={t(`tn.status.${tr.status}`)} tint={tr.status === 'running' ? theme.success : theme.textSecondary} />
          </View>
          {tr.city ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="location-outline" size={13} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{tr.city}</ThemedText>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.tournaments') }} />

      {creating ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{t('tn.create')}</ThemedText>
          <TextField label={t('tn.name')} value={name} onChangeText={setName} placeholder={t('tn.namePh')} />
          <TextField label={t('tn.desc')} value={desc} onChangeText={setDesc} placeholder={t('tn.descPh')} multiline />
          <TextField label={t('tn.city')} value={city} onChangeText={setCity} placeholder={t('tn.cityPh')} autoCapitalize="words" />

          <Field label={t('tn.ruleset')}>
            <View style={styles.chips}>
              {RULESETS.map((r) => (
                <Chip key={r} label={t(`tn.rs.${r}`)} active={rulesetPreset === r} onPress={() => applyPreset(r)} />
              ))}
            </View>
          </Field>

          <Field label={t('tn.scoringStyle')}>
            <View style={styles.chips}>
              {SCORINGS.map((sc) => (
                <Chip key={sc} label={t(sc === 'points' ? 'tn.scorePoints' : 'tn.scoreSub')} active={scoring === sc} onPress={() => setScoring(sc)} />
              ))}
            </View>
          </Field>

          <Field label={t('tn.format')}>
            <View style={styles.chips}>
              {FORMATS.map((f) => (
                <Chip key={f} label={t(`tn.fmt.${f}`)} active={format === f} onPress={() => setFormat(f)} />
              ))}
            </View>
          </Field>

          <Field label={t('tn.teamSize')}>
            <View style={styles.chips}>
              {[1, 3, 5].map((sz) => (
                <Chip key={sz} label={sz === 1 ? t('tn.individual') : `${sz}v${sz}`} active={teamSize === sz} onPress={() => pickSize(sz)} />
              ))}
            </View>
          </Field>

          {teamSize > 1 && (
            <>
              <Field label={t('tn.teamRule')}>
                <View style={styles.chips}>
                  <Chip label={t('tn.rule.duel')} active={teamRule === 'duel'} onPress={() => setTeamRule('duel')} />
                  <Chip label={t('tn.rule.quintet')} active={teamRule === 'quintet'} onPress={() => setTeamRule('quintet')} />
                </View>
              </Field>
              <Field label={t('tn.teamBuild')}>
                <View style={styles.chips}>
                  {(['host', 'captain', 'auto'] as TournamentTeamBuild[]).map((b) => (
                    <Chip key={b} label={t(`tn.build.${b}`)} active={teamBuild === b} onPress={() => setTeamBuild(b)} />
                  ))}
                </View>
              </Field>
            </>
          )}

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }}>{t('tn.ranked')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('tn.rankedHint')}</ThemedText>
            </View>
            <Switch value={ranked} onValueChange={setRanked} trackColor={{ true: theme.accent }} />
          </View>

          <View style={{ width: 90 }}><TextField label={t('tn.mats')} value={mats} onChangeText={setMats} keyboardType="number-pad" /></View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }}>{t('tn.advScoring')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('tn.advScoringHint')}</ThemedText>
            </View>
            <Switch value={advScoring} onValueChange={setAdvScoring} trackColor={{ true: theme.accent }} />
          </View>
          {advScoring && (
            <>
              <Field label={t('tn.scoring')}>
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <View style={{ flex: 1 }}><TextField label={t('tn.win')} value={winPts} onChangeText={setWinPts} keyboardType="numbers-and-punctuation" /></View>
                  <View style={{ flex: 1 }}><TextField label={t('tn.draw')} value={drawPts} onChangeText={setDrawPts} keyboardType="numbers-and-punctuation" /></View>
                  <View style={{ flex: 1 }}><TextField label={t('tn.loss')} value={lossPts} onChangeText={setLossPts} keyboardType="numbers-and-punctuation" /></View>
                </View>
              </Field>
              <ThemedText type="small" themeColor="textSecondary">{t('tn.scoreHint')}</ThemedText>
              <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                <View style={{ flex: 1 }}><TextField label={t('tn.killBonus')} value={killBonus} onChangeText={setKillBonus} keyboardType="numbers-and-punctuation" /></View>
                <View style={{ flex: 1 }}><TextField label={t('tn.breakBonus')} value={breakBonus} onChangeText={setBreakBonus} keyboardType="numbers-and-punctuation" /></View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">{t('tn.subBonusHint')}</ThemedText>
            </>
          )}

          <Button label={t('tn.createBtn')} icon="add-circle" onPress={submit} loading={busy} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label={t('tn.create')} icon="add-circle" variant="secondary" onPress={() => setCreating(true)} />
      )}

      {invites.length > 0 && (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>{t('tn.invitedSection')}</ThemedText>
          <Card style={{ paddingVertical: Spacing.one }}>
            {invites.map((iv, i) => (
              <View key={iv.tournament_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <Pressable onPress={() => router.push(`/tournament/${iv.tournament_id}`)} style={styles.row}>
                  <Ionicons name="mail-open" size={20} color={theme.accent} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{iv.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {t('tn.invitedBy').replace('{name}', iv.invited_by_name)} · {t(`tn.fmt.${iv.format}`)}
                    </ThemedText>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: Spacing.two, paddingBottom: Spacing.two }}>
                  <View style={{ flex: 1 }}><Button label={t('tn.acceptInvite')} loading={busy} onPress={() => respondInvite(iv.tournament_id, true)} /></View>
                  <View style={{ flex: 1 }}><Button label={t('tn.declineInvite')} variant="ghost" loading={busy} onPress={() => respondInvite(iv.tournament_id, false)} /></View>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

      <TextField value={cityQ} onChangeText={setCityQ} placeholder={t('tn.searchCity')} autoCapitalize="words" />

      {items.length === 0 ? (
        <EmptyState icon="trophy-outline" title={cityQ.trim() ? t('tn.noneCityTitle') : t('tn.emptyTitle')} subtitle={cityQ.trim() ? t('tn.noneCitySub') : t('tn.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.three }}>
          {open.length > 0 && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('tn.openSection')}</ThemedText>
              <Card style={{ paddingVertical: Spacing.one }}>
                {open.map(renderRow)}
              </Card>
            </View>
          )}
          {completed.length > 0 && !showCompleted && (
            <Pressable onPress={() => setShowCompleted(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
            </Pressable>
          )}
          {completed.length > 0 && showCompleted && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('tn.completedSection')}</ThemedText>
              <Card style={{ paddingVertical: Spacing.one }}>
                {completed.map(renderRow)}
              </Card>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold" themeColor="textSecondary">{label}</ThemedText>
      {children}
    </View>
  );
}
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>{label}</ThemedText>
    </Pressable>
  );
}
function Tag({ text, tint }: { text: string; tint: string }) {
  return (
    <View style={[styles.tag, { borderColor: tint }]}>
      <ThemedText type="small" style={{ color: tint, fontWeight: '700' }}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  older: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
});
