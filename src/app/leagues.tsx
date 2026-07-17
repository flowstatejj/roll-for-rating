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
import { createLeague, fetchMyLeagues, fetchMyLeagueInvites, fetchOpenLeagues, joinLeagueByCode, type LeagueInvite, respondLeagueInvite, WEEKDAYS } from '@/lib/leagues';
import { RULESET_PRESETS } from '@/lib/tournaments';
import type { League, LeagueAudience, LeagueFormat, LeagueRulesetPreset, LeagueScoring, LeagueVisibility } from '@/lib/types';
import { LEAGUE_FORMATS } from '@/lib/types';

const RULESETS: LeagueRulesetPreset[] = ['ibjjf', 'naga', 'grappling_industries', 'adcc', 'custom'];
const SCORINGS: LeagueScoring[] = ['points', 'submission_only'];
const FORMATS: LeagueFormat[] = ['individuals', 'duo', 'trio', 'quintet'];

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
  const [invites, setInvites] = useState<LeagueInvite[]>([]);
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cityQ, setCityQ] = useState('');
  const [browseExpanded, setBrowseExpanded] = useState(false);
  const cityRef = useRef('');

  // create form
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [audience, setAudience] = useState<LeagueAudience>('all');
  const [ranked, setRanked] = useState(false);
  const [advScoring, setAdvScoring] = useState(false);
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
  const [scoring, setScoring] = useState<LeagueScoring>('points');
  const [rulesetPreset, setRulesetPreset] = useState<LeagueRulesetPreset>('custom');
  const [format, setFormat] = useState<LeagueFormat>('individuals');

  // Picking a federation seeds the standings-scoring defaults (win/draw/loss +
  // sub bonuses), same as tournament create. 'custom' leaves whatever is set.
  function applyPreset(p: LeagueRulesetPreset) {
    setRulesetPreset(p);
    if (p === 'custom') return;
    const d = RULESET_PRESETS[p];
    setScoring(d.scoring);
    setWinPts(String(d.winPoints));
    setDrawPts(String(d.drawPoints));
    setLossPts(String(d.lossPoints));
    setKillBonus(String(d.subKillBonus));
    setBreakBonus(String(d.subBreakBonus));
  }

  const load = useCallback(async () => {
    try {
      const [m, b, inv] = await Promise.all([fetchMyLeagues(userId), fetchOpenLeagues({ city: cityRef.current }), fetchMyLeagueInvites()]);
      setMine(m);
      setBrowse(b);
      setInvites(inv);
    } catch (e) {
      console.warn('leagues load failed', e);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Debounced re-fetch of the browse list as the location filter changes.
  useEffect(() => {
    cityRef.current = cityQ;
    const h = setTimeout(load, 300);
    return () => clearTimeout(h);
  }, [cityQ, load]);

  async function respondInvite(leagueId: string, accept: boolean) {
    setBusy(true);
    try {
      await respondLeagueInvite(leagueId, accept);
      await load();
      if (accept) router.push(`/league/${leagueId}`);
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

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
        scoring,
        rulesetPreset,
        teamRule: LEAGUE_FORMATS[format].rule,
        teamSize: LEAGUE_FORMATS[format].size,
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
  // Browse can return up to 100 leagues; show the first 15 until expanded.
  const visibleList = tab === 'browse' && !browseExpanded ? list.slice(0, 15) : list;
  const hiddenCount = list.length - visibleList.length;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.leagues') }} />

      {/* Invitations from organizers */}
      {invites.length > 0 && (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>{t('le.invitedSection')}</ThemedText>
          <Card style={{ gap: Spacing.two }}>
            {invites.map((inv, i) => (
              <View key={inv.league_id} style={{ gap: Spacing.two }}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{inv.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{t('le.invitedBy').replace('{name}', inv.invited_by_name)}</ThemedText>
                </View>
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <View style={{ flex: 1 }}>
                    <Button label={t('le.acceptInvite')} icon="checkmark-circle" loading={busy} onPress={() => respondInvite(inv.league_id, true)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label={t('le.declineInvite')} variant="ghost" loading={busy} onPress={() => respondInvite(inv.league_id, false)} />
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

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

          {/* Format: individual season or a team season (2v2 / 3v3 / quintet). */}
          <Field label={t('le.format')}>
            <View style={styles.chips}>
              {FORMATS.map((f) => (
                <Chip key={f} label={t(`le.fmt.${f}`)} active={format === f} onPress={() => setFormat(f)} />
              ))}
            </View>
          </Field>

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

          {/* Federation ruleset preset (seeds the scoring defaults) + scoring style */}
          <Field label={t('tn.ruleset')}>
            <View style={styles.chips}>
              {RULESETS.map((r) => (
                <Chip key={r} label={t(`tn.rs.${r}`)} active={rulesetPreset === r} onPress={() => applyPreset(r)} />
              ))}
            </View>
          </Field>
          <Field label={t('tn.scoringStyle')}>
            <View style={styles.chips}>
              {SCORINGS.map((s) => (
                <Chip key={s} label={s === 'points' ? t('tn.scorePoints') : t('tn.scoreSub')} active={scoring === s} onPress={() => setScoring(s)} />
              ))}
            </View>
          </Field>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: '700' }}>{t('le.advScoring')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('le.advScoringHint')}</ThemedText>
            </View>
            <Switch value={advScoring} onValueChange={setAdvScoring} trackColor={{ true: theme.accent }} />
          </View>
          {advScoring && (
            <>
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
            </>
          )}

          <Button label={t('le.createBtn')} icon="add-circle" onPress={submitCreate} loading={busy} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setCreating(false)} />
        </Card>
      ) : (
        <Button label={t('le.create')} icon="add-circle" variant="secondary" onPress={() => setCreating(true)} />
      )}

      {/* Location search (browse only) */}
      {tab === 'browse' && (
        <TextField value={cityQ} onChangeText={setCityQ} placeholder={t('le.searchCity')} autoCapitalize="words" />
      )}

      {/* List */}
      {list.length === 0 ? (
        <EmptyState
          icon="people-circle-outline"
          title={tab === 'mine' ? t('le.noneMineTitle') : (cityQ.trim() ? t('le.noneCityTitle') : t('le.noneBrowseTitle'))}
          subtitle={tab === 'mine' ? t('le.noneMineSub') : (cityQ.trim() ? t('le.noneCitySub') : t('le.noneBrowseSub'))}
        />
      ) : (
        <>
          <Card style={{ paddingVertical: Spacing.one }}>
            {visibleList.map((l, i) => (
              <View key={l.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <Pressable onPress={() => router.push(`/league/${l.id}`)} style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                    <Ionicons name={l.audience === 'kids' ? 'happy' : 'people-circle'} size={18} color={theme.text} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{l.name}</ThemedText>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one }}>
                      <Tag text={l.ranked ? t('le.rankedChip') : t('le.casualChip')} tint={l.ranked ? theme.accent : theme.textSecondary} />
                      {l.audience !== 'all' && <Tag text={t(`le.aud.${l.audience}`)} tint={theme.textSecondary} />}
                      <ThemedText type="small" themeColor="textSecondary">
                        {t(`wd.${l.meet_day}`)}{l.meet_time ? ` · ${l.meet_time}` : ''}{l.city ? ` · ${l.city}` : ''}
                      </ThemedText>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              </View>
            ))}
          </Card>
          {hiddenCount > 0 && (
            <Pressable onPress={() => setBrowseExpanded(true)} style={[styles.morePill, { borderColor: theme.tileBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showMore')}</ThemedText>
            </Pressable>
          )}
        </>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  morePill: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
});
