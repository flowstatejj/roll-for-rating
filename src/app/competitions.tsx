import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchCompetitionRecords, importCompetitionRecord, readCompetitionLink } from '@/lib/competitions';
import { COMP_SOURCE_LABELS, type CompetitionRecord, type CompSource } from '@/lib/types';

const SOURCES: CompSource[] = ['smoothcomp', 'ibjjf', 'adcc', 'other'];

export default function CompetitionsScreen() {
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
  const userId = session!.user.id;

  const [source, setSource] = useState<CompSource>('smoothcomp');
  const [url, setUrl] = useState('');
  const [wins, setWins] = useState('');
  const [losses, setLosses] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [records, setRecords] = useState<CompetitionRecord[]>([]);

  const load = useCallback(async () => {
    try {
      setRecords(await fetchCompetitionRecords(userId));
    } catch (e) {
      console.warn('Failed to load competition records', e);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function autoRead() {
    if (!url.trim()) {
      Alert.alert('Paste a link', 'Add your profile link first.');
      return;
    }
    setReading(true);
    try {
      const r = await readCompetitionLink(source, url.trim());
      setWins(String(r.wins));
      setLosses(String(r.losses));
      Alert.alert('Read from link', `Found ${r.wins}W / ${r.losses}L — check and confirm below.`);
    } catch (e: any) {
      Alert.alert('Auto-read unavailable', e.message ?? 'Enter your W/L manually for now.');
    } finally {
      setReading(false);
    }
  }

  async function importNow() {
    const w = parseInt(wins, 10);
    const l = parseInt(losses, 10);
    if (Number.isNaN(w) || Number.isNaN(l) || w < 0 || l < 0) {
      Alert.alert('Check the numbers', 'Enter valid wins and losses.');
      return;
    }
    setBusy(true);
    try {
      const res = await importCompetitionRecord({ source, profileUrl: url.trim(), wins: w, losses: l });
      await refreshProfile();
      await load();
      const sign = res.rating_delta >= 0 ? '+' : '';
      Alert.alert(
        'Imported',
        `${COMP_SOURCE_LABELS[source]}: ${w}W / ${l}L\nRating ${sign}${res.rating_delta} → ${res.new_rating}`,
      );
      setWins('');
      setLosses('');
      setUrl('');
    } catch (e: any) {
      Alert.alert('Could not import', e.message ?? 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Competition Record' }} />

      <ThemedText themeColor="textSecondary">
        Import your tournament record. Each win is +15 rating, each loss −10. Re-importing a platform
        refreshes its contribution.
      </ThemedText>

      <Card style={{ gap: Spacing.three }}>
        {/* Source */}
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Platform
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
          label="Profile link"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://smoothcomp.com/en/profile/..."
        />

        <Button
          label="Read from link"
          icon="scan"
          variant="secondary"
          loading={reading}
          onPress={autoRead}
        />

        <View style={styles.wl}>
          <View style={{ flex: 1 }}>
            <TextField label="Wins" value={wins} onChangeText={setWins} keyboardType="number-pad" placeholder="0" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Losses" value={losses} onChangeText={setLosses} keyboardType="number-pad" placeholder="0" />
          </View>
        </View>

        <Button label="Import & apply to rating" icon="download" loading={busy} onPress={importNow} />
      </Card>

      {/* Existing records */}
      {records.length > 0 && (
        <>
          <ThemedText style={styles.sectionLabel}>Imported</ThemedText>
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
                      {r.wins}W · {r.losses}L {r.verified ? '· verified' : '· self-reported'}
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
  wl: { flexDirection: 'row', gap: Spacing.three },
  sectionLabel: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
});
