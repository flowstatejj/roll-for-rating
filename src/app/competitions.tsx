import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchCompetitionRecords, importCompetitionRecord, readCompetitionLink } from '@/lib/competitions';
import { COMP_SOURCE_LABELS, type CompetitionRecord, type CompSource } from '@/lib/types';

const SOURCES: CompSource[] = ['smoothcomp', 'ibjjf', 'adcc', 'other'];

export default function CompetitionsScreen() {
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [source, setSource] = useState<CompSource>('smoothcomp');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [records, setRecords] = useState<CompetitionRecord[]>([]);

  const load = useCallback(async () => {
    try {
      setRecords(await fetchCompetitionRecords(userId));
    } catch (e) {
      console.warn('Failed to load competition records', e);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Apply a detected record to the member's rating (one update per source / month).
  async function applyRecord(wins: number, losses: number) {
    setBusy(true);
    try {
      const res = await importCompetitionRecord({ source, profileUrl: url.trim(), wins, losses, verified: true });
      await refreshProfile();
      await load();
      const sign = res.rating_delta >= 0 ? '+' : '';
      Alert.alert(
        t('cp.importedTitle'),
        t('cp.importedBody')
          .replace('{src}', COMP_SOURCE_LABELS[source])
          .replace('{w}', String(wins))
          .replace('{l}', String(losses))
          .replace('{delta}', `${sign}${res.rating_delta}`)
          .replace('{new}', String(res.new_rating)),
      );
      setUrl('');
    } catch (e: any) {
      Alert.alert(t('cp.importFail'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  // Read the pasted link, then confirm + import the detected record.
  async function readAndImport() {
    if (!url.trim()) {
      Alert.alert(t('cp.pasteLinkTitle'), t('cp.pasteLinkBody'));
      return;
    }
    setBusy(true);
    let detected: { found: boolean; wins: number; losses: number } | null = null;
    try {
      detected = await readCompetitionLink(source, url.trim());
    } catch (e: any) {
      Alert.alert(t('cp.readFailTitle'), e.message ?? t('cp.readFailBody'));
    } finally {
      setBusy(false);
    }
    if (!detected) return;
    if (!detected.found) {
      Alert.alert(t('cp.notFoundTitle'), t('cp.notFound'));
      return;
    }
    const { wins, losses } = detected;
    Alert.alert(
      t('cp.foundTitle'),
      t('cp.foundBody').replace('{w}', String(wins)).replace('{l}', String(losses)),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('cp.import'), onPress: () => applyRecord(wins, losses) },
      ],
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.competitionRecord') }} />

      <ThemedText themeColor="textSecondary">
        {t('cp.intro')}
      </ThemedText>

      <Card style={{ gap: Spacing.three }}>
        {/* Source */}
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('cp.platform')}
          </ThemedText>
          <View style={styles.sources}>
            {SOURCES.map((s) => {
              const selected = source === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSource(s)}
                  style={[
                    styles.sourceChip,
                    { backgroundColor: selected ? theme.accent : 'transparent', borderColor: selected ? theme.accent : theme.border },
                  ]}>
                  <ThemedText style={{ color: selected ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
                    {COMP_SOURCE_LABELS[s]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextField
          label={t('cp.profileLink')}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://smoothcomp.com/en/profile/..."
        />

        <Button
          label={t('cp.readImport')}
          icon="scan"
          loading={busy}
          onPress={readAndImport}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            {t('cp.onceMonth')}
          </ThemedText>
        </View>
      </Card>

      {/* Existing records */}
      {records.length > 0 && (
        <>
          <ThemedText style={styles.sectionLabel}>{t('cp.imported')}</ThemedText>
          <Card style={{ paddingVertical: Spacing.one }}>
            {records.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={styles.recordRow}>
                  <Ionicons
                    name={r.verified ? 'shield-checkmark' : 'shield-outline'}
                    size={18}
                    color={r.verified ? theme.success : theme.textSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: '700' }}>{COMP_SOURCE_LABELS[r.source]}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {r.wins}{t('lb.w')} · {r.losses}{t('lb.l')} · {r.verified ? t('cp.verified') : t('cp.selfReported')}
                    </ThemedText>
                  </View>
                  <ThemedText style={{ fontWeight: '800', color: r.rating_delta >= 0 ? theme.success : theme.danger }}>
                    {r.rating_delta >= 0 ? `+${r.rating_delta}` : r.rating_delta}
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sourceChip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  sectionLabel: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
});
