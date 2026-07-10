import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchChampions, type Champion } from '@/lib/titles';

export default function ChampionsScreen() {
  const { profile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const [champs, setChamps] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      setChamps(await fetchChampions(profile));
    } catch (e) {
      console.warn('champions failed', e);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.champions') }} />
      <ThemedText themeColor="textSecondary">
        {t('champ.intro')}
      </ThemedText>

      {champs.length === 0 ? (
        <EmptyState icon="trophy-outline" title={t('champ.emptyTitle')} subtitle={t('champ.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {champs.map((c) => (
            <Card key={c.key} style={[styles.row, c.isMe && { borderColor: theme.accent, borderWidth: 1.5 }]}>
              <ThemedText style={{ fontSize: 26 }}>👑</ThemedText>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText style={{ fontWeight: '800' }}>{c.title}</ThemedText>
                {c.champ ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <Avatar name={c.champ.display_name} size={28} />
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {c.champ.display_name}
                      {c.isMe ? ` ${t('md.you')}` : ''} · {c.champ.rating}
                    </ThemedText>
                    <BeltChip belt={c.champ.belt_rank} size="sm" />
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('champ.vacant')}
                  </ThemedText>
                )}
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
