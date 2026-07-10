import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

interface Tutorial {
  id: string;
  title: string;
  description: string | null;
  url: string;
}

/** "How the app works" - video walkthroughs, managed as rows in public.tutorials. */
export default function TutorialsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [items, setItems] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tutorials')
        .select('id,title,description,url')
        .eq('published', true)
        .order('sort_order')
        .limit(50);
      if (error) throw error;
      setItems((data ?? []) as Tutorial[]);
    } catch (e) {
      console.warn('tutorials failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('tut.title') }} />
      <ThemedText themeColor="textSecondary">{t('tut.intro')}</ThemedText>

      {items.length === 0 ? (
        <EmptyState icon="play-circle-outline" title={t('tut.emptyTitle')} subtitle={t('tut.emptySub')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one }}>
          {items.map((v, i) => (
            <View key={v.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <Pressable onPress={() => Linking.openURL(v.url)}>
                <View style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
                    <Ionicons name="play" size={16} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{v.title}</ThemedText>
                    {v.description ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{v.description}</ThemedText>
                    ) : null}
                  </View>
                  <Ionicons name="open-outline" size={16} color={theme.textSecondary} />
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
});
