import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { createTournament, fetchTournaments } from '@/lib/tournaments';
import type { Tournament, TournamentFormat, TournamentTeamBuild, TournamentTeamRule } from '@/lib/types';

// Parse a signed integer from a text box (blank / "-" / junk -> 0).
const intval = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
};
const FORMATS: TournamentFormat[] = ['single_elim', 'round_robin', 'double_elim', 'rr_playoff'];

export default function TournamentsScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [items, setItems] = useState<Tournament[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // form
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('single_elim');
  const [teamSize, setTeamSize] = useState(1);
  const [teamRule, setTeamRule] = useState<TournamentTeamRule>('none');
  const [teamBuild, setTeamBuild] = useState<TournamentTeamBuild>('host');
  const [ranked, setRanked] = useState(false);
  const [winPts, setWinPts] = useState('3');
  const [drawPts, setDrawPts] = useState('1');
  const [lossPts, setLossPts] = useState('0');
  const [killBonus, setKillBonus] = useState('0');
  const [breakBonus, setBreakBonus] = useState('0');
  const [mats, setMats] = useState('1');

  const load = useCallback(async () => {
    try {
      setItems(await fetchTournaments());
    } catch (e) {
      console.warn('tournaments load failed', e);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
      });
      setCreating(false);
      setName(''); setDesc('');
      router.push(`/tournament/${id}`);
    } catch (e: any) {
      Alert.alert(t('tn.createFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.tournaments') }} />

      {creating ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{t('tn.create')}</ThemedText>
          <TextField label={t('tn.name')} value={name} onChangeText={setName} placeholder={t('tn.namePh')} />
          <TextField label={t('tn.desc')} value={desc} onChangeText={setDesc} placeholder={t('tn.descPh')} multiline />

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
            <View style={{ width: 90 }}><TextField label={t('tn.mats')} value={mats} onChangeText={setMats} keyboardType="number-pad" /></View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{t('tn.subBonusHint')}</ThemedText>

          <Button label={t('tn.createBtn')} icon="add-circle" onPress={submit} loading={busy} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label={t('tn.create')} icon="add-circle" variant="secondary" onPress={() => setCreating(true)} />
      )}

      {items.length === 0 ? (
        <EmptyState icon="trophy-outline" title={t('tn.emptyTitle')} subtitle={t('tn.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {items.map((tr) => (
            <Pressable key={tr.id} onPress={() => router.push(`/tournament/${tr.id}`)}>
              <Card style={styles.row}>
                <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                  <Ionicons name="trophy" size={22} color={theme.text} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{tr.name}</ThemedText>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one }}>
                    <Tag text={t(`tn.fmt.${tr.format}`)} tint={theme.textSecondary} />
                    <Tag text={tr.team_rule === 'none' ? t('tn.individual') : `${tr.team_size}v${tr.team_size}`} tint={theme.textSecondary} />
                    <Tag text={tr.ranked ? t('tn.rankedChip') : t('tn.casualChip')} tint={tr.ranked ? theme.accent : theme.textSecondary} />
                    <Tag text={t(`tn.status.${tr.status}`)} tint={tr.status === 'running' ? theme.success : theme.textSecondary} />
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </Card>
            </Pressable>
          ))}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
});
