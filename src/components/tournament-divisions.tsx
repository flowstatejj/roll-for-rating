import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import {
  createDivision,
  createGuestCompetitor,
  deleteDivision,
  divisionSummary,
  fetchDivisionRoster,
  fetchDivisions,
  removeGuestCompetitor,
} from '@/lib/tournaments';
import { kgToLbs, lbsToKg } from '@/lib/weight';
import {
  ADULT_BELTS,
  BELT_COLORS,
  BELT_LABELS,
  YOUTH_BELTS,
  beltNeedsDarkText,
  type BeltRank,
  type DivisionRosterEntry,
  type TournamentDivision,
  type TournamentFormat,
} from '@/lib/types';

// Adult belts first, then the youth colors (drop the duplicate 'white').
const BELT_OPTIONS: BeltRank[] = [
  ...ADULT_BELTS,
  ...YOUTH_BELTS.filter((b) => !ADULT_BELTS.includes(b)),
];
const FORMATS: TournamentFormat[] = ['round_robin', 'single_elim', 'double_elim', 'rr_playoff'];

const intN = (s: string): number | null => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};
const floatN = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Host-only "Divisions" builder: lists a tournament's divisions with a human
 * summary + delete control, and an expandable form to add one (belt / age /
 * weight [lbs or kg] / rating / gender / format / open). Weight is stored
 * canonically in kg; the entered unit is remembered on the division.
 */
export function TournamentDivisions({ tournamentId, onChanged }: { tournamentId: string; onChanged?: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [divs, setDivs] = useState<TournamentDivision[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [beltMin, setBeltMin] = useState<BeltRank | null>(null);
  const [beltMax, setBeltMax] = useState<BeltRank | null>(null);
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [wMin, setWMin] = useState('');
  const [wMax, setWMax] = useState('');
  const [wUnit, setWUnit] = useState<'lbs' | 'kg'>('lbs');
  const [ratingMin, setRatingMin] = useState('');
  const [ratingMax, setRatingMax] = useState('');
  const [gender, setGender] = useState<'any' | 'male' | 'female'>('any');
  const [ruleset, setRuleset] = useState<'gi' | 'nogi' | 'any'>('any');
  const [fmt, setFmt] = useState<TournamentFormat | null>(null);
  const [open, setOpen] = useState(false);

  const sumLabels = { open: t('tdv.openSummary'), all: t('tdv.allSummary'), male: t('tdv.male'), female: t('tdv.female'), gi: t('tdv.gi'), nogi: t('tdv.nogi') };

  const reload = useCallback(async () => {
    try {
      setDivs(await fetchDivisions(tournamentId));
    } catch (e) {
      console.warn('divisions load failed', e);
    }
  }, [tournamentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  function resetForm() {
    setName('');
    setBeltMin(null);
    setBeltMax(null);
    setAgeMin('');
    setAgeMax('');
    setWMin('');
    setWMax('');
    setWUnit('lbs');
    setRatingMin('');
    setRatingMax('');
    setGender('any');
    setRuleset('any');
    setFmt(null);
    setOpen(false);
  }

  async function submit() {
    const nm = name.trim();
    if (!nm) {
      Alert.alert(t('tdv.nameRequired'));
      return;
    }
    const toKg = (v: number | null) => (v == null ? null : wUnit === 'lbs' ? lbsToKg(v) : v);
    setBusy(true);
    try {
      if (open) {
        await createDivision({ tid: tournamentId, name: nm, open: true, ruleset });
      } else {
        await createDivision({
          tid: tournamentId,
          name: nm,
          ruleset,
          beltMin,
          beltMax,
          ageMin: intN(ageMin),
          ageMax: intN(ageMax),
          weightMinKg: toKg(floatN(wMin)),
          weightMaxKg: toKg(floatN(wMax)),
          weightUnit: wUnit,
          ratingMin: intN(ratingMin),
          ratingMax: intN(ratingMax),
          gender,
          format: fmt,
          open: false,
        });
      }
      resetForm();
      setShowForm(false);
      await reload();
      onChanged?.();
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(d: TournamentDivision) {
    // A generated (running) division has a live bracket: deleting it erases all
    // of its bouts, so that case gets a much louder warning.
    const body = d.status === 'running'
      ? t('tdv.deleteRunningBody').replace('{name}', d.name)
      : t('tdv.deleteBody').replace('{name}', d.name);
    Alert.alert(t('tdv.deleteTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tdv.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDivision(d.id);
            await reload();
            onChanged?.();
          } catch (e: any) {
            Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <>
      <View style={styles.sectionRow}>
        <ThemedText style={styles.section}>{t('tdv.sectionTitle')}</ThemedText>
        <Button
          label={showForm ? t('common.cancel') : t('tdv.addDivision')}
          icon={showForm ? undefined : 'add'}
          variant={showForm ? 'ghost' : 'secondary'}
          onPress={() => setShowForm((s) => !s)}
        />
      </View>

      {divs.length === 0 && !showForm ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('tdv.none')}
        </ThemedText>
      ) : null}

      {divs.map((d) => (
        <DivisionCard
          key={d.id}
          division={d}
          tournamentId={tournamentId}
          summary={divisionSummary(d, sumLabels)}
          onDelete={() => confirmDelete(d)}
          onChanged={async () => {
            await reload();
            onChanged?.();
          }}
        />
      ))}

      {showForm && (
        <Card style={{ gap: Spacing.two }}>
          <TextField label={t('tdv.nameLabel')} value={name} onChangeText={setName} placeholder={t('tdv.namePh')} />

          {/* Ruleset (Gi / No-Gi) - applies whether or not the division is open */}
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('tdv.rulesetLabel')}
            </ThemedText>
            <View style={styles.pairRow}>
              <SelChip flex label={t('tdv.rulesetAny')} selected={ruleset === 'any'} onPress={() => setRuleset('any')} />
              <SelChip flex label={t('tdv.gi')} selected={ruleset === 'gi'} onPress={() => setRuleset('gi')} />
              <SelChip flex label={t('tdv.nogi')} selected={ruleset === 'nogi'} onPress={() => setRuleset('nogi')} />
            </View>
          </View>

          {/* Open (no restrictions) */}
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('tdv.openLabel')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('tdv.openHint')}
              </ThemedText>
            </View>
            <Switch value={open} onValueChange={setOpen} trackColor={{ true: theme.accent, false: theme.border }} />
          </View>

          {!open && (
            <>
              {/* Belt range */}
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.beltRange')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('tdv.min')}
                </ThemedText>
                <BeltRow value={beltMin} onChange={setBeltMin} anyLabel={t('tdv.any')} />
                <ThemedText type="small" themeColor="textSecondary">
                  {t('tdv.max')}
                </ThemedText>
                <BeltRow value={beltMax} onChange={setBeltMax} anyLabel={t('tdv.any')} />
              </View>

              {/* Age range */}
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.ageRange')}
                </ThemedText>
                <View style={styles.pairRow}>
                  <View style={{ flex: 1 }}>
                    <TextField value={ageMin} onChangeText={setAgeMin} keyboardType="number-pad" placeholder={t('tdv.min')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField value={ageMax} onChangeText={setAgeMax} keyboardType="number-pad" placeholder={t('tdv.max')} />
                  </View>
                </View>
              </View>

              {/* Weight range with unit toggle */}
              <View style={{ gap: Spacing.one }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('tdv.weightRange')}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                    <SelChip label="lbs" selected={wUnit === 'lbs'} onPress={() => setWUnit('lbs')} />
                    <SelChip label="kg" selected={wUnit === 'kg'} onPress={() => setWUnit('kg')} />
                  </View>
                </View>
                <View style={styles.pairRow}>
                  <View style={{ flex: 1 }}>
                    <TextField value={wMin} onChangeText={setWMin} keyboardType="decimal-pad" placeholder={t('tdv.min')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField value={wMax} onChangeText={setWMax} keyboardType="decimal-pad" placeholder={t('tdv.max')} />
                  </View>
                </View>
              </View>

              {/* Rating range */}
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.ratingRange')}
                </ThemedText>
                <View style={styles.pairRow}>
                  <View style={{ flex: 1 }}>
                    <TextField value={ratingMin} onChangeText={setRatingMin} keyboardType="number-pad" placeholder={t('tdv.min')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField value={ratingMax} onChangeText={setRatingMax} keyboardType="number-pad" placeholder={t('tdv.max')} />
                  </View>
                </View>
              </View>

              {/* Gender */}
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.genderLabel')}
                </ThemedText>
                <View style={styles.pairRow}>
                  <SelChip flex label={t('tdv.any')} selected={gender === 'any'} onPress={() => setGender('any')} />
                  <SelChip flex label={t('tdv.male')} selected={gender === 'male'} onPress={() => setGender('male')} />
                  <SelChip flex label={t('tdv.female')} selected={gender === 'female'} onPress={() => setGender('female')} />
                </View>
              </View>

              {/* Format (optional; inherits the tournament) */}
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.formatLabel')}
                </ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingRight: Spacing.two }}>
                  <SelChip label={t('tdv.inherit')} selected={fmt == null} onPress={() => setFmt(null)} />
                  {FORMATS.map((f) => (
                    <SelChip key={f} label={t(`tn.fmt.${f}`)} selected={fmt === f} onPress={() => setFmt(f)} />
                  ))}
                </ScrollView>
              </View>
            </>
          )}

          <Button label={t('tdv.create')} icon="checkmark-circle" loading={busy} onPress={submit} />
        </Card>
      )}
    </>
  );
}

/**
 * One division row: tap to expand its roster (members + host-entered guests),
 * remove a guest, or open a quick "add guest" form for non-member competitors.
 */
function DivisionCard({
  division,
  tournamentId,
  summary,
  onDelete,
  onChanged,
}: {
  division: TournamentDivision;
  tournamentId: string;
  summary: string;
  onDelete: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [roster, setRoster] = useState<DivisionRosterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showGuest, setShowGuest] = useState(false);
  const [busy, setBusy] = useState(false);

  // Guest quick-add form (host bypasses eligibility - the guest goes straight in)
  const [gName, setGName] = useState('');
  const [gBelt, setGBelt] = useState<BeltRank>('white');
  const [gGender, setGGender] = useState<'any' | 'male' | 'female'>('any');
  const [gWeight, setGWeight] = useState('');
  const [gUnit, setGUnit] = useState<'lbs' | 'kg'>('lbs');

  const loadRoster = useCallback(async () => {
    setLoading(true);
    try {
      setRoster(await fetchDivisionRoster(division.id));
    } catch (e) {
      console.warn('roster load failed', e);
    } finally {
      setLoading(false);
    }
  }, [division.id]);

  useEffect(() => {
    if (expanded) loadRoster();
  }, [expanded, loadRoster]);

  async function addGuest() {
    const nm = gName.trim();
    if (!nm) {
      Alert.alert(t('tgu.nameRequired'));
      return;
    }
    const w = parseFloat(gWeight);
    const weightLbs = Number.isFinite(w) && w > 0 ? (gUnit === 'kg' ? kgToLbs(w) : w) : null;
    setBusy(true);
    try {
      const res = await createGuestCompetitor(tournamentId, {
        name: nm,
        divisionId: division.id,
        belt: gBelt,
        weightLbs,
        gender: gGender === 'any' ? null : gGender,
      });
      if (!res.ok) throw new Error(t('tgu.addFailed'));
      setGName('');
      setGWeight('');
      setGBelt('white');
      setGGender('any');
      await loadRoster();
      await onChanged();
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemoveGuest(entry: DivisionRosterEntry) {
    Alert.alert(t('tgu.removeTitle'), t('tgu.removeBody').replace('{name}', entry.display_name), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tdv.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeGuestCompetitor(tournamentId, entry.user_id);
            await loadRoster();
            await onChanged();
          } catch (e: any) {
            Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <Card style={{ gap: Spacing.two }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <Pressable onPress={() => setExpanded((s) => !s)} style={{ flex: 1 }} hitSlop={6}>
          <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>
            {division.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {summary}
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          {t('tdv.entrants').replace('{n}', String(division.entrant_count))}
        </ThemedText>
        <Pressable onPress={() => setExpanded((s) => !s)} hitSlop={8} style={{ padding: Spacing.one }}>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} style={{ padding: Spacing.one }}>
          <Ionicons name="trash-outline" size={18} color={theme.danger} />
        </Pressable>
      </View>

      {expanded && (
        <View style={{ gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: Spacing.two }}>
          {loading ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('tgu.loading')}
            </ThemedText>
          ) : roster.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('tgu.noEntrants')}
            </ThemedText>
          ) : (
            roster.map((r) => (
              <View key={r.user_id} style={styles.rosterRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                      {r.display_name}
                    </ThemedText>
                    {r.is_guest && (
                      <View style={[styles.badge, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {t('tgu.guestBadge')}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {BELT_LABELS[r.belt_rank]}
                    {r.weight_lbs != null ? ` · ${Math.round(r.weight_lbs)} lbs` : ''}
                    {r.gender ? ` · ${r.gender === 'male' ? t('tdv.male') : t('tdv.female')}` : ''}
                  </ThemedText>
                </View>
                {r.is_guest && (
                  <Pressable onPress={() => confirmRemoveGuest(r)} hitSlop={8} style={{ padding: Spacing.one }}>
                    <Ionicons name="close-circle-outline" size={18} color={theme.danger} />
                  </Pressable>
                )}
              </View>
            ))
          )}

          {division.status !== 'setup' ? (
            // Once the bracket is generated a new entrant can never be drawn in,
            // so adding guests is locked instead of silently doing nothing.
            <ThemedText type="small" themeColor="textSecondary">
              {t('tgu.bracketLocked')}
            </ThemedText>
          ) : showGuest ? (
            <Card style={{ gap: Spacing.two, backgroundColor: theme.backgroundElement }}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('tgu.addTitle')}
              </ThemedText>
              <TextField label={t('tgu.nameLabel')} value={gName} onChangeText={setGName} placeholder={t('tgu.namePh')} />
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.beltRange')}
                </ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingRight: Spacing.two }}>
                  {BELT_OPTIONS.map((b) => (
                    <BeltSelChip key={b} belt={b} selected={gBelt === b} onPress={() => setGBelt(b)} />
                  ))}
                </ScrollView>
              </View>
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('tdv.genderLabel')}
                </ThemedText>
                <View style={styles.pairRow}>
                  <SelChip flex label={t('tdv.any')} selected={gGender === 'any'} onPress={() => setGGender('any')} />
                  <SelChip flex label={t('tdv.male')} selected={gGender === 'male'} onPress={() => setGGender('male')} />
                  <SelChip flex label={t('tdv.female')} selected={gGender === 'female'} onPress={() => setGGender('female')} />
                </View>
              </View>
              <View style={{ gap: Spacing.one }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {t('tgu.weightLabel')}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                    <SelChip label="lbs" selected={gUnit === 'lbs'} onPress={() => setGUnit('lbs')} />
                    <SelChip label="kg" selected={gUnit === 'kg'} onPress={() => setGUnit('kg')} />
                  </View>
                </View>
                <TextField value={gWeight} onChangeText={setGWeight} keyboardType="decimal-pad" placeholder={t('tgu.weightPh')} />
              </View>
              <View style={styles.pairRow}>
                <View style={{ flex: 1 }}>
                  <Button label={t('common.cancel')} variant="ghost" onPress={() => setShowGuest(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label={t('tgu.add')} icon="person-add" loading={busy} onPress={addGuest} />
                </View>
              </View>
            </Card>
          ) : (
            <Button label={t('tgu.addGuest')} icon="person-add" variant="secondary" onPress={() => setShowGuest(true)} />
          )}
        </View>
      )}
    </Card>
  );
}

// Horizontal belt selector with a leading "Any" (null) chip.
function BeltRow({ value, onChange, anyLabel }: { value: BeltRank | null; onChange: (b: BeltRank | null) => void; anyLabel: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingRight: Spacing.two }}>
      <SelChip label={anyLabel} selected={value == null} onPress={() => onChange(null)} />
      {BELT_OPTIONS.map((b) => (
        <BeltSelChip key={b} belt={b} selected={value === b} onPress={() => onChange(b)} />
      ))}
    </ScrollView>
  );
}

function BeltSelChip({ belt, selected, onPress }: { belt: BeltRank; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? BELT_COLORS[belt] : theme.backgroundElement, borderColor: selected ? BELT_COLORS[belt] : theme.border },
      ]}>
      <ThemedText style={{ fontWeight: '700', fontSize: 13, color: selected ? (beltNeedsDarkText(belt) ? '#222' : '#fff') : theme.text }}>
        {BELT_LABELS[belt]}
      </ThemedText>
    </Pressable>
  );
}

function SelChip({ label, selected, onPress, flex }: { label: string; selected: boolean; onPress: () => void; flex?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        flex && { flex: 1, alignItems: 'center' },
        { backgroundColor: selected ? theme.accent : theme.backgroundElement, borderColor: selected ? theme.accent : theme.border },
      ]}>
      <ThemedText style={{ fontWeight: '700', fontSize: 13, color: selected ? theme.accentText : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.one },
  pairRow: { flexDirection: 'row', gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 10, borderWidth: 1 },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { paddingVertical: 2, paddingHorizontal: Spacing.two, borderRadius: 6, borderWidth: 1 },
});
