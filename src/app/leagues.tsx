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
import { createLeague, fetchMyLeagues, fetchOpenLeagues, joinLeagueByCode, WEEKDAYS } from '@/lib/leagues';
import type { League, LeagueAudience, LeagueVisibility } from '@/lib/types';

type Tab = 'mine' | 'browse';
// Parse a signed integer from a text box (blank / "-" / junk -> 0).
const intval = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LeaguesScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [tab, setTab] = useState<Tab>('mine');
  const [mine, setMine] = useState<League[]>([]);
  const [browse, setBrowse] = useState<League[]>([]);
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // create form
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [audience, setAudience] = useState<LeagueAudience>('all');
  const [ranked, setRanked] = useState(false);
  const [visibility, setVisibility] = useState<LeagueVisibility>('open');
  const [meetDay, setMeetDay] = useState(5);
  const [meetTime, setMeetTime] = useState('');
  const [location, setLocation] = useState('');
  const [city, setCity] = useState('');
  const [weeks, setWeeks] = useState('8');
  const [winPts, setWinPts] = useState('3');
  const [drawPts, setDrawPts] = useState('1');
  const [lossPts, setLossPts] = useState('0');
  const [killBonus, setKillBonus] = useState('0');
  const [breakBonus, setBreakBonus] = useState('0');

  const load = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([fetchMyLeagues(userId), fetchOpenLeagues()]);
      setMine(m);
      setBrowse(b);
    } catch (e) {
      console.warn('leagues load failed', e);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submitCreate() {
    if (!name.trim()) {
      Alert.alert(t('le.name'), t('le.nameReq'));
      return;
    }
    setBusy(true);
    try {
      const league = await createLeague({
        createdBy: userId,
        name,
        description: desc,
        audience,
        ranked,
        visibility,
        meetDay,
        meetTime,
        location,
        city,
        seasonStarts: todayISO(),
        weeks: Math.max(1, Math.min(52, parseInt(weeks, 10) || 8)),
        winPoints: intval(winPts),
        drawPoints: intval(drawPts),
        lossPoints: intval(lossPts),
        subKillBonus: intval(killBonus),
        subBreakBonus: intval(breakBonus),
      });
      setCreating(false);
      setName(''); setDesc(''); setLocation(''); setCity('');
      router.push(`/league/${league.id}`);
    } catch (e: any) {
      Alert.alert(t('le.createFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  async function submitJoinCode() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const id = await joinLeagueByCode(code.trim());
      setCode('');
      await load();
      router.push(`/league/${id}`);
    } catch (e: any) {
      Alert.alert(t('le.joinFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  const list = tab === 'mine' ? mine : browse;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.leagues') }} />

      <View style={styles.segment}>
        <Seg label={t('le.mine')} active={tab === 'mine'} onPress={() => setTab('mine')} />
        <Seg label={t('le.browse')} active={tab === 'browse'} onPress={() => setTab('browse')} />
      </View>

      {/* Join by code */}
      <Card style={{ gap: Spacing.two }}>
        <ThemedText style={{ fontWeight: '800' }}>{t('le.joinByCode')}</ThemedText>
        <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField value={code} onChangeText={setCode} placeholder={t('le.codePlaceholder')} autoCapitalize="characters" />
          </View>
          <Button label={t('le.join')} onPress={submitJoinCode} loading={busy} />
        </View>
      </Card>

      {/* Create toggle / form */}
      {creating ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{t('le.create')}</ThemedText>
          <TextField label={t('le.name')} value={name} onChangeText={setName} placeholder={t('le.namePh')} />
          <TextField label={t('le.desc')} value={desc} onChangeText={setDesc} placeholder={t('le.descPh')} multiline />

          <Field label={t('le.audience')}>
            <View style={styles.chips}>
              {(['all', 'kids', 'adults'] as LeagueAudience[]).map((a) => (
                <Chip key={a} label={t(`le.aud.${a}`)} active={audience === a} onPress={() => setAudience(a)} />
              ))}
            </View>
          </Field>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }}>{t('le.ranked')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('le.rankedHint')}</ThemedText>
            </View>
            <Switch value={ranked} onValueChange={setRanked} trackColor={{ true: theme.accent }} />
          </View>

          <Field label={t('le.visibility')}>
            <View style={styles.chips}>
              {(['open', 'private'] as LeagueVisibility[]).map((v) => (
                <Chip key={v} label={t(`le.vis.${v}`)} active={visibility === v} onPress={() => setVisibility(v)} />
              ))}
            </View>
          </Field>

          <Field label={t('le.meetDay')}>
            <View style={styles.chips}>
              {WEEKDAYS.map((d, i) => (
                <Chip key={d} label={t(`wd.${i}`)} active={meetDay === i} onPress={() => setMeetDay(i)} />
              ))}
            </View>
          </Field>

          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <View style={{ flex: 1 }}><TextField label={t('le.meetTime')} value={meetTime} onChangeText={setMeetTime} placeholder={t('le.meetTimePh')} /></View>
            <View style={{ width: 120 }}><TextField label={t('le.weeks')} value={weeks} onChangeText={setWeeks} keyboardType="number-pad" /></View>
          </View>
          <TextField label={t('le.location')} value={location} onChangeText={setLocation} placeholder={t('le.locationPh')} />
          <TextField label={t('le.city')} value={city} onChangeText={setCity} autoCapitalize="words" />

          <Field label={t('le.scoring')}>
            <View style={{ flexDirection: 'row', gap: Spacing.two }}>
              <View style={{ flex: 1 }}><TextField label={t('le.win')} value={winPts} onChangeText={setWinPts} keyboardType="numbers-and-punctuation" /></View>
              <View style={{ flex: 1 }}><TextField label={t('le.draw')} value={drawPts} onChangeText={setDrawPts} keyboardType="numbers-and-punctuation" /></View>
              <View style={{ flex: 1 }}><TextField label={t('le.loss')} value={lossPts} onChangeText={setLossPts} keyboardType="numbers-and-punctuation" /></View>
            </View>
          </Field>
          <ThemedText type="small" themeColor="textSecondary">{t('le.scoreHint')}</ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <View style={{ flex: 1 }}><TextField label={t('le.killBonus')} value={killBonus} onChangeText={setKillBonus} keyboardType="numbers-and-punctuation" /></View>
            <View style={{ flex: 1 }}><TextField label={t('le.breakBonus')} value={breakBonus} onChangeText={setBreakBonus} keyboardType="numbers-and-punctuation" /></View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{t('le.subBonusHint')}</ThemedText>

          <Button label={t('le.createBtn')} icon="add-circle" onPress={submitCreate} loading={busy} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label={t('le.create')} icon="add-circle" variant="secondary" onPress={() => setCreating(true)} />
      )}

      {/* List */}
      {list.length === 0 ? (
        <EmptyState
          icon="people-circle-outline"
          title={tab === 'mine' ? t('le.noneMineTitle') : t('le.noneBrowseTitle')}
          subtitle={tab === 'mine' ? t('le.noneMineSub') : t('le.noneBrowseSub')}
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((l) => (
            <Pressable key={l.id} onPress={() => router.push(`/league/${l.id}`)}>
              <Card style={styles.row}>
                <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                  <Ionicons name={l.audience === 'kids' ? 'happy' : 'people-circle'} size={22} color={theme.text} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{l.name}</ThemedText>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one }}>
                    <Tag text={l.ranked ? t('le.rankedChip') : t('le.casualChip')} tint={l.ranked ? theme.accent : theme.textSecondary} />
                    {l.audience !== 'all' && <Tag text={t(`le.aud.${l.audience}`)} tint={theme.textSecondary} />}
                    <ThemedText type="small" themeColor="textSecondary">
                      {t(`wd.${l.meet_day}`)}{l.meet_time ? ` · ${l.meet_time}` : ''}
                    </ThemedText>
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
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
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

function Seg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.seg, { backgroundColor: active ? theme.accent : 'transparent' }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700' }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: 'rgba(127,127,127,0.15)', borderRadius: 10, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
});
