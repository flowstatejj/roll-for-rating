import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { useSubscription } from '@/lib/subscription';

// Live, review-reachable legal pages (also set as the App Store metadata URLs).
const TERMS_URL = 'https://rfr-site.onrender.com/terms.html';
const PRIVACY_URL = 'https://rfr-site.onrender.com/privacy.html';

/**
 * Hard paywall. The root navigator redirects here whenever a signed-in,
 * onboarded user has no active entitlement. There is intentionally no dismiss —
 * the only ways out are subscribing, restoring a purchase, or signing out.
 */
export default function PaywallScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const { product, purchase, purchasing, restore } = useSubscription();
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    track('paywall_view');
  }, []);

  const price = product?.displayPrice ?? t('pw.priceFallback');
  const trialLine = t('pw.trial').replace(/\{price\}/g, price);
  const legal = t('pw.legal').replace(/\{price\}/g, price);
  const features = [t('pw.f1'), t('pw.f2'), t('pw.f3'), t('pw.f4')];

  async function onSubscribe() {
    track('paywall_subscribe_tap');
    try {
      await purchase();
    } catch (e) {
      const code = String((e as { code?: string })?.code ?? '');
      if (/cancel/i.test(code)) return; // user backed out — not an error
      Alert.alert(t('pw.error'));
    }
  }

  async function onRestore() {
    setRestoring(true);
    try {
      const active = await restore();
      // If it worked, the root navigator redirects away automatically.
      if (!active) Alert.alert(t('pw.restoredNone'));
    } catch {
      Alert.alert(t('pw.error'));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      <View style={styles.header}>
        <Ionicons name="ribbon" size={44} color={theme.accent} />
        <ThemedText type="title" style={{ fontSize: 26, textAlign: 'center' }}>
          {t('pw.title')}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {t('pw.subtitle')}
        </ThemedText>
      </View>

      <Card style={{ gap: Spacing.three }}>
        {features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
            <ThemedText style={{ flex: 1, fontWeight: '600' }}>{f}</ThemedText>
          </View>
        ))}
      </Card>

      <View style={{ gap: Spacing.two, alignItems: 'center' }}>
        <ThemedText style={{ fontWeight: '800', fontSize: 18, textAlign: 'center' }}>
          {trialLine}
        </ThemedText>
        <Button label={t('pw.cta')} onPress={onSubscribe} loading={purchasing} icon="rocket" />
        <Button label={t('pw.restore')} onPress={onRestore} variant="ghost" loading={restoring} />
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', lineHeight: 17 }}>
        {legal}
      </ThemedText>

      <View style={styles.links}>
        <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={8}>
          <ThemedText type="small" style={{ color: theme.accent }}>
            {t('pw.terms')}
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          ·
        </ThemedText>
        <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={8}>
          <ThemedText type="small" style={{ color: theme.accent }}>
            {t('pw.privacy')}
          </ThemedText>
        </Pressable>
      </View>

      <Pressable onPress={() => signOut()} hitSlop={8} style={{ alignSelf: 'center', paddingTop: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('pw.signOut')}
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
});
