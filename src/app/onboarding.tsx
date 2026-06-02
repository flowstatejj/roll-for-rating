import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

const STEPS: { icon: keyof typeof Ionicons.glyphMap; titleKey: string; bodyKey: string }[] = [
  { icon: 'flame', titleKey: 'onb.step1Title', bodyKey: 'onb.step1Body' },
  { icon: 'eye', titleKey: 'onb.step2Title', bodyKey: 'onb.step2Body' },
  { icon: 'trending-up', titleKey: 'onb.step3Title', bodyKey: 'onb.step3Body' },
];

export default function OnboardingScreen() {
  const { session, markOnboarded } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [city, setCity] = useState('');
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  async function finish(save: boolean) {
    setBusy(true);
    try {
      if (save) {
        await supabase
          .from('profiles')
          .update({ city: city.trim() || null, open_for_challenge: open })
          .eq('id', userId);
      }
    } catch (e) {
      console.warn('onboarding save failed', e);
    }
    await markOnboarded();
    setBusy(false);
    router.replace('/(tabs)');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={[styles.logo, { backgroundColor: theme.accent }]}>
          <Ionicons name="trophy" size={28} color={theme.accentText} />
        </View>
        <ThemedText type="title" style={{ fontSize: 30, textAlign: 'center' }}>
          {t('onb.welcome')}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {t('onb.intro')}
        </ThemedText>
      </View>

      {STEPS.map((s, i) => (
        <Card key={i} style={styles.step}>
          <View style={[styles.stepIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name={s.icon} size={22} color={theme.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t(s.titleKey)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(s.bodyKey)}
            </ThemedText>
          </View>
        </Card>
      ))}

      <ThemedText style={styles.section}>{t('onb.setup')}</ThemedText>
      <Card style={{ gap: Spacing.three }}>
        <TextField label={t('onb.cityLabel')} value={city} onChangeText={setCity} autoCapitalize="words" placeholder={t('onb.cityPlaceholder')} />
        <View style={styles.openRow}>
          <Ionicons name="flame" size={20} color={open ? theme.accent : theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t('onb.openTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('onb.openSub')}
            </ThemedText>
          </View>
          <Switch value={open} onValueChange={setOpen} trackColor={{ true: theme.accent }} />
        </View>
      </Card>

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {t('onb.tip')}
      </ThemedText>

      <Button label={t('onb.getStarted')} icon="arrow-forward" loading={busy} onPress={() => finish(true)} />
      <Button label={t('onb.skip')} variant="ghost" onPress={() => finish(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  logo: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
