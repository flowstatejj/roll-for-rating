import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { applyInviteOrReferralCode } from '@/lib/elite';
import { applyGymAccount, myGymApplication, type GymApplication } from '@/lib/gym-account';
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

      <CodeSection />

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

      <GymApplySection />

      <Pressable onPress={() => signOut()} hitSlop={8} style={{ alignSelf: 'center', paddingTop: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('pw.signOut')}
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

/**
 * Post-signup code entry. Elite invite codes unlock free access right here
 * (the refresh flips the entitlement and the root navigator redirects away);
 * referral codes only attach attribution, so the paywall stays.
 */
function CodeSection() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { refresh } = useSubscription();
  const [open, setOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [applying, setApplying] = useState(false);

  async function apply() {
    const entered = codeInput.trim().toUpperCase();
    if (!entered) return;
    setApplying(true);
    try {
      const res = await applyInviteOrReferralCode(entered);
      track('paywall_code_apply', { kind: res.kind });
      if (res.kind === 'elite') {
        Alert.alert(t('code.eliteOk'));
        await refresh();
      } else if (res.kind === 'referral') {
        setCodeInput('');
        Alert.alert(t('code.referralOk').replace('{name}', res.name ?? entered));
      } else if (res.kind === 'referralAlready') {
        Alert.alert(t('code.already'));
      } else if (res.kind === 'eliteAlready') {
        Alert.alert(t('code.eliteAlready'));
        await refresh(); // they already hold elite - make sure the gate sees it
      } else {
        Alert.alert(t('code.invalid'));
      }
    } catch {
      Alert.alert(t('pw.error'));
    } finally {
      setApplying(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={{ alignSelf: 'center' }}>
        <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }}>{t('code.have')}</ThemedText>
      </Pressable>
    );
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <ThemedText style={{ fontWeight: '800' }}>{t('code.section')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t('code.hint')}</ThemedText>
      <TextField
        value={codeInput}
        onChangeText={setCodeInput}
        placeholder={t('code.ph')}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Button label={t('code.apply')} icon="ticket" onPress={apply} loading={applying} disabled={!codeInput.trim()} />
    </Card>
  );
}

/**
 * Gym accounts are free but verified. The application lives on the paywall
 * because that's where an unsubscribed gym owner lands; approval comps the
 * account, so the navigator lets them through on the next check.
 */
function GymApplySection() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState<GymApplication | null>(null);
  const [gymName, setGymName] = useState('');
  const [address, setAddress] = useState('');
  const [link, setLink] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    myGymApplication().then(setApp).catch(() => {});
  }, []);

  async function submit() {
    if (!gymName.trim() || !address.trim() || !link.trim() || !ownerName.trim()) {
      Alert.alert(t('gy.applyTitle'), t('gy.allRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await applyGymAccount(gymName, address, link, ownerName);
      setApp({ status: 'pending', gym_name: gymName.trim(), note: null, created_at: new Date().toISOString() });
    } catch (e: any) {
      Alert.alert(t('gy.applyTitle'), e.message ?? t('md.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  // Pending or approved: show status instead of the form.
  if (app && app.status !== 'denied') {
    return (
      <Card style={{ gap: Spacing.two, alignItems: 'center' }}>
        <Ionicons name="business" size={22} color={theme.accent} />
        <ThemedText style={{ fontWeight: '800' }}>{app.gym_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {app.status === 'pending' ? t('gy.pending') : t('gy.approved')}
        </ThemedText>
      </Card>
    );
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={{ alignSelf: 'center' }}>
        <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }}>{t('gy.ownGym')}</ThemedText>
      </Pressable>
    );
  }

  return (
    <Card style={{ gap: Spacing.three }}>
      <ThemedText style={{ fontWeight: '800' }}>{t('gy.applyTitle')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t('gy.applyIntro')}</ThemedText>
      {app?.status === 'denied' && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {t('gy.denied')}{app.note ? ` ${app.note}` : ''}
        </ThemedText>
      )}
      <TextField label={t('gy.gymName')} value={gymName} onChangeText={setGymName} placeholder="Flow State Jiu Jitsu" />
      <TextField label={t('gy.address')} value={address} onChangeText={setAddress} placeholder="123 Main St, Peyton, CO" />
      <TextField
        label={t('gy.link')} value={link} onChangeText={setLink}
        placeholder="https://..." autoCapitalize="none" keyboardType="url"
      />
      <TextField label={t('gy.ownerName')} value={ownerName} onChangeText={setOwnerName} placeholder="John Keil" />
      <Button label={t('gy.submit')} icon="business" onPress={submit} loading={submitting} />
    </Card>
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
          <ThemedText style={{ fontWeight: '800', fontSize: 16, flex: 1 }} numberOfLines={1}>{title}</ThemedText>
          {badge ? (
            <View style={{ backgroundColor: theme.accent, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2, flexShrink: 0 }}>
              <ThemedText type="small" style={{ color: theme.accentText, fontWeight: '800' }} numberOfLines={1}>{badge}</ThemedText>
            </View>
          ) : null}
        </View>
        {/* Price on its own line so long titles + the badge never crush it on narrow phones. */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one, marginLeft: 28 }}>
          <ThemedText style={{ fontWeight: '900', fontSize: 16, flexShrink: 0 }}>{price}</ThemedText>
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
