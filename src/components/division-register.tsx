import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { divisionSummary, fetchDivisions, fetchEligibleDivisions, registerDivision } from '@/lib/tournaments';
import { kgToLbs } from '@/lib/weight';
import type { EligibleDivision, TournamentDivision } from '@/lib/types';

/**
 * Competitor-facing "Divisions" list for a division-based tournament. Shows each
 * division with its summary and the computed eligibility state: eligible ones
 * (incl. youth move-up / adult move-down, with a note) get a Register button;
 * a missing weight or gender is captured inline before Register is enabled;
 * ineligible divisions are greyed with the reason. Register persists the
 * captured datum + joins the division, then refreshes.
 */
export function DivisionRegister({ tournamentId, onChanged }: { tournamentId: string; onChanged?: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [divs, setDivs] = useState<TournamentDivision[]>([]);
  const [elig, setElig] = useState<EligibleDivision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [wInput, setWInput] = useState<Record<string, string>>({});
  const [wUnit, setWUnit] = useState<Record<string, 'lbs' | 'kg'>>({});
  const [gInput, setGInput] = useState<Record<string, 'male' | 'female' | undefined>>({});

  const sumLabels = { open: t('tdv.openSummary'), all: t('tdv.allSummary'), male: t('tdv.male'), female: t('tdv.female'), gi: t('tdv.gi'), nogi: t('tdv.nogi') };

  const reload = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([fetchDivisions(tournamentId), fetchEligibleDivisions(tournamentId)]);
      setDivs(d);
      setElig(e);
    } catch (err) {
      console.warn('eligible divisions load failed', err);
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function doRegister(ed: EligibleDivision) {
    const opts: { weightLbs?: number | null; gender?: 'male' | 'female' | null } = {};
    if (ed.note === 'missing_weight') {
      const raw = parseFloat(wInput[ed.division_id] ?? '');
      if (!Number.isFinite(raw) || raw <= 0) {
        Alert.alert(t('tdv.enterWeight'));
        return;
      }
      const unit = wUnit[ed.division_id] ?? ed.weight_unit;
      opts.weightLbs = unit === 'kg' ? kgToLbs(raw) : raw;
    }
    if (ed.note === 'missing_gender') {
      const g = gInput[ed.division_id];
      if (!g) {
        Alert.alert(t('tdv.pickGender'));
        return;
      }
      opts.gender = g;
    }
    setBusyId(ed.division_id);
    try {
      const r = await registerDivision(ed.division_id, opts);
      if (r.ok) {
        await reload();
        onChanged?.();
      } else {
        Alert.alert(t('tdv.registerFailed'), t(`tdv.reason.${r.reason}`));
        await reload();
      }
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusyId(null);
    }
  }

  function ineligibleReason(ed: EligibleDivision): string {
    const failed: string[] = [];
    if (!ed.fit.belt) failed.push(t('tdv.axisBelt'));
    if (!ed.fit.age) failed.push(t('tdv.axisAge'));
    if (!ed.fit.weight) failed.push(t('tdv.axisWeight'));
    if (!ed.fit.rating) failed.push(t('tdv.axisRating'));
    if (!ed.fit.gender) failed.push(t('tdv.axisGender'));
    if (failed.length === 0) return t('tdv.notEligible');
    return t('tdv.notEligibleAxes').replace('{axes}', failed.join(', '));
  }

  function renderAction(ed: EligibleDivision) {
    const busy = busyId === ed.division_id;
    if (ed.note === 'missing_weight') {
      const unit = wUnit[ed.division_id] ?? ed.weight_unit;
      return (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('tdv.needWeight')}
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <TextField
                value={wInput[ed.division_id] ?? ''}
                onChangeText={(v) => setWInput((s) => ({ ...s, [ed.division_id]: v }))}
                keyboardType="decimal-pad"
                placeholder={t('tdv.weightPh')}
              />
            </View>
            <SelChip label="lbs" selected={unit === 'lbs'} onPress={() => setWUnit((s) => ({ ...s, [ed.division_id]: 'lbs' }))} />
            <SelChip label="kg" selected={unit === 'kg'} onPress={() => setWUnit((s) => ({ ...s, [ed.division_id]: 'kg' }))} />
          </View>
          <Button label={t('tdv.register')} icon="add-circle" loading={busy} onPress={() => doRegister(ed)} />
        </View>
      );
    }
    if (ed.note === 'missing_gender') {
      const g = gInput[ed.division_id];
      return (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('tdv.needGender')}
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <SelChip flex label={t('tdv.male')} selected={g === 'male'} onPress={() => setGInput((s) => ({ ...s, [ed.division_id]: 'male' }))} />
            <SelChip flex label={t('tdv.female')} selected={g === 'female'} onPress={() => setGInput((s) => ({ ...s, [ed.division_id]: 'female' }))} />
          </View>
          <Button label={t('tdv.register')} icon="add-circle" loading={busy} onPress={() => doRegister(ed)} />
        </View>
      );
    }
    if (ed.eligible) {
      return (
        <View style={{ gap: Spacing.one }}>
          {ed.note === 'move_up' && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('tdv.moveUpNote')}
            </ThemedText>
          )}
          {ed.note === 'move_down' && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('tdv.moveDownNote')}
            </ThemedText>
          )}
          <Button label={t('tdv.register')} icon="add-circle" loading={busy} onPress={() => doRegister(ed)} />
        </View>
      );
    }
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {ineligibleReason(ed)}
      </ThemedText>
    );
  }

  if (loading || elig.length === 0) return null;

  const byId = new Map(divs.map((d): [string, TournamentDivision] => [d.id, d]));

  return (
    <>
      <ThemedText style={styles.section}>{t('tdv.sectionTitle')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('tdv.competitorHint')}
      </ThemedText>
      {elig.map((ed) => {
        const d = byId.get(ed.division_id);
        const summary = d ? divisionSummary(d, sumLabels) : '';
        const greyed = !ed.already && !ed.eligible && ed.note !== 'missing_weight' && ed.note !== 'missing_gender';
        return (
          <Card key={ed.division_id} style={{ gap: Spacing.two, opacity: greyed ? 0.6 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>
                  {ed.name}
                </ThemedText>
                {summary ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {summary}
                  </ThemedText>
                ) : null}
              </View>
              {ed.already && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                  <ThemedText type="small" style={{ color: theme.success, fontWeight: '700' }}>
                    {t('tdv.joined')}
                  </ThemedText>
                </View>
              )}
            </View>
            {!ed.already && renderAction(ed)}
          </Card>
        );
      })}
    </>
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
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 10, borderWidth: 1 },
});
