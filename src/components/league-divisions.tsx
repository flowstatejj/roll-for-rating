import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { createLeagueDivision, deleteLeagueDivision, fetchLeagueDivisions } from '@/lib/leagues';
import { divisionSummary } from '@/lib/tournaments';
import { lbsToKg } from '@/lib/weight';
import {
  ADULT_BELTS,
  BELT_COLORS,
  BELT_LABELS,
  YOUTH_BELTS,
  beltNeedsDarkText,
  type BeltRank,
  type LeagueDivision,
} from '@/lib/types';

const BELT_OPTIONS: BeltRank[] = [...ADULT_BELTS, ...YOUTH_BELTS.filter((b) => !ADULT_BELTS.includes(b))];

const intN = (s: string): number | null => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};
const floatN = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Organizer-only "Divisions" builder for a league. Same eligibility fields as
 * the tournament builder (belt / age / weight / rating / gender / Gi-No-Gi /
 * open), minus the bracket format - a league division is always the weekly
 * circle method. Weight is stored canonically in kg.
 */
export function LeagueDivisions({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [divs, setDivs] = useState<LeagueDivision[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const [open, setOpen] = useState(false);

  const sumLabels = { open: t('tdv.openSummary'), all: t('tdv.allSummary'), male: t('tdv.male'), female: t('tdv.female'), gi: t('tdv.gi'), nogi: t('tdv.nogi') };

  const reload = useCallback(async () => {
    try {
      setDivs(await fetchLeagueDivisions(leagueId));
    } catch (e) {
      console.warn('league divisions load failed', e);
    }
  }, [leagueId]);

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
        await createLeagueDivision({ leagueId, name: nm, open: true, ruleset });
      } else {
        await createLeagueDivision({
          leagueId,
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

  function confirmDelete(d: LeagueDivision) {
    Alert.alert(t('tdv.deleteTitle'), t('tdv.deleteBody').replace('{name}', d.name), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tdv.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLeagueDivision(d.id);
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
        <Card key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>
              {d.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {divisionSummary(d, sumLabels)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t('tdv.entrants').replace('{n}', String(d.entrant_count))}
          </ThemedText>
          <Pressable onPress={() => confirmDelete(d)} hitSlop={8} style={{ padding: Spacing.one }}>
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </Pressable>
        </Card>
      ))}

      {showForm && (
        <Card style={{ gap: Spacing.two }}>
          <TextField label={t('tdv.nameLabel')} value={name} onChangeText={setName} placeholder={t('tdv.namePh')} />

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
            </>
          )}

          <Button label={t('tdv.create')} icon="checkmark-circle" loading={busy} onPress={submit} />
        </Card>
      )}
    </>
  );
}

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
});
