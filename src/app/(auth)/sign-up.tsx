import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { PENDING_REFERRAL_KEY } from '@/lib/referrals';

const TERMS_URL = 'https://rfr-site.onrender.com/terms.html';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { parseDob } from '@/lib/dob';
import { useTranslation } from '@/lib/i18n';
import { BELT_COLORS, type BeltRank } from '@/lib/types';

const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [belt, setBelt] = useState<BeltRank>('white');
  const [dobM, setDobM] = useState('');
  const [dobD, setDobD] = useState('');
  const [dobY, setDobY] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [refCode, setRefCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Prefill a referral code from a ?ref= route param or the opening deep link.
  const params = useLocalSearchParams<{ ref?: string }>();
  useEffect(() => {
    if (params.ref) { setRefCode(String(params.ref).toUpperCase()); return; }
    Linking.getInitialURL()
      .then((url) => {
        const m = url?.match(/[?&]ref=([^&]+)/i);
        if (m) setRefCode(decodeURIComponent(m[1]).toUpperCase());
      })
      .catch(() => {});
  }, [params.ref]);

  const dob = parseDob(dobM, dobD, dobY);
  const isMinor = dob !== null && dob.age < 18;
  const isKid = dob !== null && dob.age < 14;

  async function onSubmit() {
    if (!displayName.trim() || !username.trim() || !email.trim() || !password) {
      Alert.alert(t('su.missingTitle'), t('su.missingBody'));
      return;
    }
    if (password.length < 6) {
      Alert.alert(t('su.weakTitle'), t('su.weakBody'));
      return;
    }
    if (!dob) {
      Alert.alert(t('su.dob'), t('su.dobInvalidFull'));
      return;
    }
    if (dob.age < 0 || dob.age > 120) {
      Alert.alert(t('su.dob'), t('su.dobUnreal'));
      return;
    }
    if (isKid) {
      Alert.alert(t('su.askParentTitle'), t('su.askParentBody'));
      return;
    }
    if (isMinor && !parentEmail.trim()) {
      Alert.alert(t('su.parentEmail'), t('su.parentEmailReqBody'));
      return;
    }
    if (!agreed) {
      Alert.alert(t('su.agreeReqTitle'), t('su.agreeReqBody'));
      return;
    }
    setLoading(true);
    try {
      await signUp({
        email: email.trim(),
        password,
        username: username.trim(),
        displayName: displayName.trim(),
        beltRank: belt,
        birthdate: dob.iso,
        parentEmail: isMinor ? parentEmail.trim() : null,
      });
      // Captured here, attached on first sign-in (see AuthProvider).
      if (refCode.trim()) await AsyncStorage.setItem(PENDING_REFERRAL_KEY, refCode.trim().toUpperCase());
      Alert.alert(
        t('su.createdTitle'),
        isMinor ? t('su.createdMinor') : t('su.createdAdult'),
        [{ text: t('common.ok'), onPress: () => router.replace('/(auth)/sign-in') }],
      );
    } catch (e: any) {
      Alert.alert(t('su.failedTitle'), e.message ?? t('su.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedText type="title" style={{ fontSize: 34, marginBottom: Spacing.three }}>
          {t('su.title')}
        </ThemedText>

        <View style={styles.form}>
          <TextField label={t('su.displayName')} value={displayName} onChangeText={setDisplayName} placeholder="Ryan K" />
          <TextField
            label={t('su.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="ryank"
          />
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <TextField label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry placeholder={t('su.passwordPlaceholder')} />

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('su.beltRank')}
            </ThemedText>
            <View style={styles.belts}>
              {BELTS.map((b) => {
                const selected = belt === b;
                return (
                  <Pressable
                    key={b}
                    onPress={() => setBelt(b)}
                    style={[
                      styles.beltOption,
                      {
                        backgroundColor: selected ? BELT_COLORS[b] : theme.backgroundElement,
                        borderColor: selected ? BELT_COLORS[b] : theme.border,
                      },
                    ]}>
                    <ThemedText
                      style={{
                        fontWeight: '700',
                        fontSize: 13,
                        color: selected ? (b === 'white' ? '#222' : '#fff') : theme.text,
                      }}>
                      {t(`belt.${b}`)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('su.dob')}
            </ThemedText>
            <View style={styles.dobRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="MM"
                  value={dobM}
                  onChangeText={(t) => setDobM(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="MM"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="DD"
                  value={dobD}
                  onChangeText={(t) => setDobD(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="DD"
                />
              </View>
              <View style={{ flex: 1.6 }}>
                <TextField
                  label="YYYY"
                  value={dobY}
                  onChangeText={(t) => setDobY(t.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  placeholder="YYYY"
                />
              </View>
            </View>
          </View>

          {isKid && (
            <View style={[styles.kidNotice, { borderColor: theme.accent, backgroundColor: theme.accent + '14' }]}>
              <ThemedText style={{ fontWeight: '800' }}>{t('su.kidNoticeTitle')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('su.kidNoticeBody')}
              </ThemedText>
            </View>
          )}

          {isMinor && !isKid && (
            <View style={{ gap: Spacing.one }}>
              <TextField
                label={t('su.parentEmail')}
                value={parentEmail}
                onChangeText={setParentEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="parent@example.com"
              />
              <ThemedText type="small" themeColor="textSecondary">
                {t('su.teenNote')}
              </ThemedText>
            </View>
          )}

          <TextField
            label={t('su.referralCode')}
            value={refCode}
            onChangeText={(v) => setRefCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={t('su.referralPlaceholder')}
          />

          <Pressable onPress={() => setAgreed((v) => !v)} style={styles.agreeRow}>
            <Ionicons
              name={agreed ? 'checkbox' : 'square-outline'}
              size={22}
              color={agreed ? theme.accent : theme.textSecondary}
            />
            <ThemedText type="small" style={{ flex: 1 }}>
              {t('su.agreePrefix')}{' '}
              <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }} onPress={() => Linking.openURL(TERMS_URL)}>
                {t('su.agreeTerms')}
              </ThemedText>
              {'. '}{t('su.agreeZeroTol')}
            </ThemedText>
          </Pressable>

          <Button label={t('su.title')} onPress={onSubmit} loading={loading} disabled={isKid || !agreed} />

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">{t('su.haveAccount')}</ThemedText>
            <Link href="/(auth)/sign-in">
              <ThemedText style={{ color: theme.accent, fontWeight: '700' }}>{t('auth.signIn')}</ThemedText>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  belts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  dobRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  kidNotice: { gap: 4, borderWidth: 1, borderRadius: 10, padding: Spacing.three },
  agreeRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  beltOption: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: 1,
  },
  footer: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center', marginTop: Spacing.two },
});
