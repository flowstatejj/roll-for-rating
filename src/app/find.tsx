import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchFriendlyOpponents, fetchOpenChallengers } from '@/lib/social';
import { type BeltRank, type Profile } from '@/lib/types';

type Mode = 'network' | 'area';
const BELTS: (BeltRank | 'any')[] = ['any', 'white', 'blue', 'purple', 'brown', 'black'];

export default function FindScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [mode, setMode] = useState<Mode>(profile?.gym_id ? 'network' : 'area');
  const [city, setCity] = useState(profile?.city ?? '');
  const [belt, setBelt] = useState<BeltRank | 'any'>('any');
  const [results, setResults] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    try {
      if (mode === 'network') {
        if (!profile?.gym_id) return setResults([]);
        setResults(await fetchFriendlyOpponents(userId, profile.gym_id));
      } else {
        setResults(await fetchOpenChallengers(userId, { city, belt: belt === 'any' ? null : belt }));
      }
    } catch (e) {
      console.warn('find failed', e);
    }
  }, [mode, userId, profile?.gym_id, city, belt]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.findRoll') }} />

      {/* Mode toggle */}
      <View style={styles.segment}>
        <Seg label={t('find.network')} active={mode === 'network'} onPress={() => setMode('network')} />
        <Seg label={t('find.area')} active={mode === 'area'} onPress={() => setMode('area')} />
      </View>

      {mode === 'network' ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('find.networkNote')}
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {t('find.areaNote')}
          </ThemedText>
          <TextField label={t('find.areaCity')} value={city} onChangeText={setCity} autoCapitalize="words" placeholder={t('find.anyCity')} />
          <View style={styles.belts}>
            {BELTS.map((b) => {
              const active = belt === b;
              return (
                <Pressable
                  key={b}
                  onPress={() => setBelt(b)}
                  style={[styles.chip, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
                  <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
                    {b === 'any' ? t('find.anyBelt') : t(`belt.${b}`)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {mode === 'network' && !profile?.gym_id ? (
        <EmptyState icon="barbell-outline" title={t('find.joinFirst')} subtitle={t('find.joinFirstSub')} />
      ) : results.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={t('find.nobody')}
          subtitle={mode === 'network' ? t('find.nobodyNetwork') : t('find.nobodyArea')}
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {results.map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/match/new?opponent=${p.id}`)}>
              <Card style={styles.row}>
                <Avatar name={p.display_name} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {p.display_name}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' }}>
                    <BeltChip belt={p.belt_rank} size="sm" />
                    <ThemedText type="small" themeColor="textSecondary">
                      {p.rating}
                      {p.city ? ` · ${p.city}` : ''}
                    </ThemedText>
                  </View>
                </View>
                <View style={[styles.challenge, { backgroundColor: theme.accent }]}>
                  <Ionicons name="flame" size={16} color={theme.accentText} />
                  <ThemedText style={{ color: theme.accentText, fontWeight: '700', fontSize: 13 }}>{t('find.challenge')}</ThemedText>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Seg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.seg, { backgroundColor: active ? theme.accent : 'transparent' }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700' }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: 'rgba(127,127,127,0.15)', borderRadius: 10, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 8 },
  belts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  challenge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
