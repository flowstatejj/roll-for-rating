import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LANGUAGES, useTranslation, type LangCode } from '@/lib/i18n';

export default function SettingsScreen() {
  const theme = useTheme();
  const { t, lang, setLang } = useTranslation();
  const [open, setOpen] = useState(false);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  function choose(code: LangCode) {
    setLang(code);
    setOpen(false);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('settings.title') }} />

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('settings.language').toUpperCase()}
      </ThemedText>

      {/* Dropdown trigger */}
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Card style={styles.row}>
          <Ionicons name="language" size={20} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t('settings.language')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {current.label}
            </ThemedText>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textSecondary} />
        </Card>
      </Pressable>

      {/* Dropdown options */}
      {open && (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {LANGUAGES.map((l, i) => {
            const selected = l.code === lang;
            return (
              <View key={l.code}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <Pressable onPress={() => choose(l.code)}>
                  <View style={[styles.option, selected && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                    <ThemedText style={{ flex: 1, fontWeight: selected ? '800' : '600' }}>{l.label}</ThemedText>
                    {selected && <Ionicons name="checkmark-circle" size={20} color={theme.accent} />}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.languageHint')}
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
