import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { createOpenMat, deleteOpenMat, fetchOpenMatRegions, fetchOpenMats } from '@/lib/social';
import type { OpenMat } from '@/lib/types';

type FilterKey = 'country' | 'state' | 'city';

const uniqSorted = (vals: (string | null)[]) =>
  Array.from(new Set(vals.filter((v): v is string => !!v && v.trim() !== ''))).sort((a, b) =>
    a.localeCompare(b),
  );

export default function OpenMatsScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [stateF, setStateF] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [open, setOpen] = useState<FilterKey | null>(null);

  const [regions, setRegions] = useState<Pick<OpenMat, 'city' | 'state' | 'country'>[]>([]);
  const [mats, setMats] = useState<OpenMat[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', city: '', state: '', country: '', address: '', schedule: '', notes: '' });

  const load = useCallback(async () => {
    try {
      setMats(await fetchOpenMats({ query, city, state: stateF, country }));
    } catch (e) {
      console.warn('load open mats failed', e);
    }
  }, [query, city, stateF, country]);

  const loadRegions = useCallback(async () => {
    try {
      setRegions(await fetchOpenMatRegions());
    } catch (e) {
      console.warn('load regions failed', e);
    }
  }, []);

  useEffect(() => {
    const tmr = setTimeout(load, 250);
    return () => clearTimeout(tmr);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadRegions();
    }, [load, loadRegions]),
  );

  // Cascading option lists — each level is narrowed by the one above it.
  const countryOpts = useMemo(() => uniqSorted(regions.map((r) => r.country)), [regions]);
  const stateOpts = useMemo(
    () => uniqSorted(regions.filter((r) => !country || r.country === country).map((r) => r.state)),
    [regions, country],
  );
  const cityOpts = useMemo(
    () =>
      uniqSorted(
        regions
          .filter((r) => (!country || r.country === country) && (!stateF || r.state === stateF))
          .map((r) => r.city),
      ),
    [regions, country, stateF],
  );

  function pick(key: FilterKey, value: string | null) {
    if (key === 'country') {
      setCountry(value);
      setStateF(null);
      setCity(null);
    } else if (key === 'state') {
      setStateF(value);
      setCity(null);
    } else {
      setCity(value);
    }
    setOpen(null);
  }

  function clearFilters() {
    setCountry(null);
    setStateF(null);
    setCity(null);
    setOpen(null);
  }

  const hasFilters = !!(country || stateF || city);
  const optionsFor: Record<FilterKey, string[]> = { country: countryOpts, state: stateOpts, city: cityOpts };
  const valueFor: Record<FilterKey, string | null> = { country, state: stateF, city };

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    if (!form.title.trim()) {
      Alert.alert(t('om.titleReqTitle'), t('om.titleReqBody'));
      return;
    }
    setBusy(true);
    try {
      await createOpenMat({
        createdBy: userId,
        title: form.title,
        city: form.city,
        state: form.state,
        country: form.country,
        address: form.address,
        schedule: form.schedule,
        notes: form.notes,
        gymId: profile?.gym_id ?? null,
      });
      setForm({ title: '', city: '', state: '', country: '', address: '', schedule: '', notes: '' });
      setAdding(false);
      await Promise.all([load(), loadRegions()]);
    } catch (e: any) {
      Alert.alert(t('om.postFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(id: string) {
    Alert.alert(t('om.removeTitle'), t('om.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('om.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOpenMat(id);
            await load();
          } catch (e: any) {
            Alert.alert(t('om.deleteFail'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.openMats') }} />

      {adding ? (
        <Card style={{ gap: Spacing.three }}>
          <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>{t('om.post')}</ThemedText>
          <TextField label={t('om.title')} value={form.title} onChangeText={(v) => set('title', v)} placeholder="Saturday Open Mat" />
          <TextField label={t('om.city')} value={form.city} onChangeText={(v) => set('city', v)} placeholder="Springfield" />
          <View style={{ flexDirection: 'row', gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('om.state')} value={form.state} onChangeText={(v) => set('state', v)} placeholder="IL" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={t('om.country')} value={form.country} onChangeText={(v) => set('country', v)} placeholder="USA" />
            </View>
          </View>
          <TextField label={t('om.address')} value={form.address} onChangeText={(v) => set('address', v)} placeholder="123 Main St" />
          <TextField label={t('om.when')} value={form.schedule} onChangeText={(v) => set('schedule', v)} placeholder="Saturdays 11:00 AM" />
          <TextField label={t('md.notes')} value={form.notes} onChangeText={(v) => set('notes', v)} multiline placeholder="All levels welcome, $10 drop-in" />
          {profile?.gym_id ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('om.gymGeoHint')}
            </ThemedText>
          ) : null}
          <Button label={t('om.postBtn')} icon="megaphone" loading={busy} onPress={submit} />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button label={t('om.post')} icon="megaphone" onPress={() => setAdding(true)} />
      )}

      <TextField label={t('om.search')} value={query} onChangeText={setQuery} autoCapitalize="none" placeholder={t('om.searchPlaceholder')} />

      {/* Location filters: Country → State → City */}
      <View style={{ gap: Spacing.two }}>
        <View style={styles.filterRow}>
          <FilterPill label={t('om.country')} value={country} disabled={false} active={open === 'country'} onPress={() => setOpen(open === 'country' ? null : 'country')} />
          <FilterPill label={t('om.state')} value={stateF} disabled={stateOpts.length === 0} active={open === 'state'} onPress={() => setOpen(open === 'state' ? null : 'state')} />
          <FilterPill label={t('om.city')} value={city} disabled={cityOpts.length === 0} active={open === 'city'} onPress={() => setOpen(open === 'city' ? null : 'city')} />
          {hasFilters && (
            <Pressable onPress={clearFilters} hitSlop={8} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">{t('om.clear')}</ThemedText>
            </Pressable>
          )}
        </View>

        {open && (
          <Card style={{ padding: Spacing.one, maxHeight: 240 }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <FilterOption label={t('om.all')} selected={valueFor[open] === null} onPress={() => pick(open, null)} />
              {optionsFor[open].map((opt) => (
                <FilterOption key={opt} label={opt} selected={valueFor[open] === opt} onPress={() => pick(open, opt)} />
              ))}
              {optionsFor[open].length === 0 && (
                <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.two }}>
                  {t('om.noRegions')}
                </ThemedText>
              )}
            </ScrollView>
          </Card>
        )}
      </View>

      {mats.length === 0 ? (
        <EmptyState icon="calendar-outline" title={t('om.emptyTitle')} subtitle={hasFilters || query ? t('om.noMatch') : t('om.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {mats.map((m) => (
            <Card key={m.id} style={{ gap: Spacing.one }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ThemedText style={{ fontSize: 16, fontWeight: '800', flex: 1 }}>{m.title}</ThemedText>
                {m.created_by === userId && (
                  <Pressable onPress={() => confirmDelete(m.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={theme.danger} />
                  </Pressable>
                )}
              </View>
              {m.schedule ? <Row icon="time-outline" text={m.schedule} /> : null}
              {(m.city || m.state || m.country || m.address) ? (
                <Row icon="location-outline" text={[m.address, m.city, m.state, m.country].filter(Boolean).join(' · ')} />
              ) : null}
              {m.notes ? <ThemedText themeColor="textSecondary">{m.notes}</ThemedText> : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function FilterPill({
  label,
  value,
  active,
  disabled,
  onPress,
}: {
  label: string;
  value: string | null;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const showValue = value ?? label;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.pill,
        {
          backgroundColor: value ? theme.accent : theme.tile,
          borderColor: active ? theme.accent : theme.tileBorder,
          opacity: disabled ? 0.4 : 1,
        },
      ]}>
      <ThemedText numberOfLines={1} style={{ color: value ? theme.accentText : theme.text, fontWeight: '700', fontSize: 12, maxWidth: 90 }}>
        {showValue}
      </ThemedText>
      <Ionicons name={active ? 'chevron-up' : 'chevron-down'} size={13} color={value ? theme.accentText : theme.textSecondary} />
    </Pressable>
  );
}

function FilterOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.option, selected && { backgroundColor: theme.accent + '22' }]}>
      <ThemedText style={{ fontWeight: selected ? '800' : '500', flex: 1 }}>{label}</ThemedText>
      {selected && <Ionicons name="checkmark" size={16} color={theme.accent} />}
    </Pressable>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={15} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
  },
});
