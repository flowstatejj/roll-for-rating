import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchPuzzleStats } from '@/lib/puzzles';
import type { PuzzleStats } from '@/lib/types';

export default function PuzzlesScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session?.user.id;
  const [stats, setStats] = useState<PuzzleStats | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setStats(await fetchPuzzleStats(userId));
    } catch (e) {
      console.warn('Failed to load puzzle stats', e);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!stats) return <Loading />;

  return (
    <Screen>
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        {t('tab.puzzles')}
      </ThemedText>
      <ThemedText themeColor="textSecondary">
        {t('pz.intro')}
      </ThemedText>

      {/* Stats */}
      <Card style={styles.statsRow}>
        <Stat label={t('pz.solved')} value={stats.solved} />
        <Divider />
        <Stat label={t('pz.accuracy')} value={`${stats.accuracy}%`} />
        <Divider />
        <Stat label={t('pz.attempts')} value={stats.attempts} />
      </Card>

      {/* Modes */}
      <ThemedText style={styles.sectionLabel}>{t('pz.chooseMode')}</ThemedText>

      <Pressable onPress={() => router.push('/puzzle/solve?kind=multiple_choice')}>
        <Card style={styles.modeCard}>
          <View style={[styles.modeIcon, { backgroundColor: theme.accent }]}>
            <Ionicons name="list" size={24} color={theme.accentText} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>{t('pz.mcTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('pz.mcSub')}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
        </Card>
      </Pressable>

      {/* Written mode — AI-graded */}
      <Pressable onPress={() => router.push('/puzzle/solve?kind=written')}>
        <Card style={styles.modeCard}>
          <View style={[styles.modeIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="create" size={24} color={theme.text} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={{ fontSize: 18, fontWeight: '800' }}>{t('pz.writtenTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('pz.writtenSub')}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
        </Card>
      </Pressable>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <ThemedText style={{ fontSize: 22, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: theme.border, alignSelf: 'stretch' }} />;
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  sectionLabel: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  modeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  modeIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  soon: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
});
