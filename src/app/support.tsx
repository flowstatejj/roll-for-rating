import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useTranslation } from '@/lib/i18n';
import { submitSupportRequest, type SupportCategory } from '@/lib/support';

const CATEGORIES: SupportCategory[] = ['general', 'bug', 'account', 'billing', 'safety', 'feature'];

export default function SupportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [category, setCategory] = useState<SupportCategory>('general');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  async function onSend() {
    if (!body.trim()) {
      Alert.alert(t('sp.empty'));
      return;
    }
    setSending(true);
    try {
      await submitSupportRequest({ category, subject, body });
      track('support_request', { category });
      Alert.alert(t('sp.sentTitle'), t('sp.sentBody'), [{ text: t('common.ok'), onPress: () => router.back() }]);
    } catch {
      Alert.alert(t('sp.error'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('sp.title') }} />

      <ThemedText themeColor="textSecondary">{t('sp.intro')}</ThemedText>

      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('sp.category').toUpperCase()}
      </ThemedText>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => {
          const selected = c === category;
          return (
            <Pressable key={c} onPress={() => setCategory(c)}>
              <View
                style={[
                  styles.chip,
                  { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accent + '22' : 'transparent' },
                ]}>
                <ThemedText style={{ fontWeight: selected ? '800' : '600', color: selected ? theme.accent : theme.text }}>
                  {t(`sp.cat.${c}`)}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>

      <TextField label={t('sp.subject')} value={subject} onChangeText={setSubject} placeholder={t('sp.subjectPh')} />
      <TextField
        label={t('sp.message')}
        value={body}
        onChangeText={setBody}
        placeholder={t('sp.messagePh')}
        multiline
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />

      <Button label={t('sp.send')} icon="send" onPress={onSend} loading={sending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 8, borderWidth: 1, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
