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
  const { product, familyProduct, purchase, purchasing, restore } = useSubscription();
  const [restoring, setRestoring] = useState(false);
  const [selected, setSelected] = useState<'individual' | 'family'>('individual');

  useEffect(() => {
    track('paywall_view');
  }, []);

  const indivPrice = product?.displayPrice ?? t('pw.priceFallback');
  const familyPrice = familyProduct?.displayPrice ?? t('pw.familyPriceFallback');
  const price = selected === 'family' ? familyPrice : indivPrice;
  const trialLine = t('pw.trial').replace(/\{price\}/g, price);
  const legal = t('pw.legal').replace(/\{price\}/g, price);
  const features = [t('pw.f1'), t('pw.f2'), t('pw.f3'), t('pw.f4')];

  async function onSubscribe() {
    track('paywall_subscribe_tap', { plan: selected });
    try {
      await purchase(selected);
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

      <View style={{ gap: Spacing.two }}>
        <PlanCard
          title={t('pw.indivTitle')}
          price={indivPrice}
          per={t('pw.perMonth')}
          blurb={t('pw.indivBlurb')}
          selected={selected === 'individual'}
          onPress={() => setSelected('individual')}
        />
        <PlanCard
          title={t('pw.familyTitle')}
          price={familyPrice}
          per={t('pw.perMonth')}
          blurb={t('pw.familyBlurb')}
          badge={t('pw.familyBadge')}
          selected={selected === 'family'}
          onPress={() => setSelected('family')}
        />
      </View>

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

function PlanCard({
  title,
  price,
  per,
  blurb,
  badge,
  selected,
  onPress,
}: {
  title: string;
  price: string;
  per: string;
  blurb: string;
  badge?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress}>
      <Card style={{ borderWidth: 2, borderColor: selected ? theme.accent : theme.tileBorder, gap: Spacing.one }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Ionicons
            name={selected ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selected ? theme.accent : theme.textSecondary}
          />
          <ThemedText style={{ fontWeight: '800', fontSize: 16, flex: 1 }}>{title}</ThemedText>
          {badge ? (
            <View style={{ backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 }}>
              <ThemedText type="small" style={{ color: theme.accentText, fontWeight: '800' }}>{badge}</ThemedText>
            </View>
          ) : null}
          <ThemedText style={{ fontWeight: '900', fontSize: 16 }}>{price}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{per}</ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={{ marginLeft: 28 }}>{blurb}</ThemedText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.four },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
});
