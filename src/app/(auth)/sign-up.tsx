import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

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
  const [loading, setLoading] = useState(false);

  const dob = parseDob(dobM, dobD, dobY);
  const isMinor = dob !== null && dob.age < 18;
  const isKid = dob !== null && dob.age < 14;

  async function onSubmit() {
    if (!displayName.trim() || !username.trim() || !email.trim() || !password) {
      Alert.alert('Missing info', 'Please fill in every field.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Use at least 6 characters.');
      return;
    }
    if (!dob) {
      Alert.alert('Date of birth', 'Please enter a valid date of birth (MM / DD / YYYY).');
      return;
    }
    if (dob.age < 0 || dob.age > 120) {
      Alert.alert('Date of birth', "That date doesn't look right — please check it.");
      return;
    }
    if (isKid) {
      Alert.alert(
        'Ask a parent to add you',
        'Under-14 accounts are created and managed by a parent or guardian from their own account. Ask them to add you under “My juniors”.',
      );
      return;
    }
    if (isMinor && !parentEmail.trim()) {
      Alert.alert('Parent / guardian email', "Under-18 accounts need a parent or guardian's email so they can approve the account.");
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
      Alert.alert(
        'Account created',
        isMinor
          ? "We've set up the account. Your parent/guardian needs to approve it from the email we'll send before you can compete. If email confirmation is on, also check your inbox to confirm, then sign in."
          : 'If email confirmation is on, check your inbox to confirm — then sign in.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/sign-in') }],
      );
    } catch (e: any) {
      Alert.alert('Sign up failed', e.message ?? 'Please try again.');
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

          <Button label={t('su.title')} onPress={onSubmit} loading={loading} disabled={isKid} />

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
  beltOption: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: 1,
  },
  footer: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center', marginTop: Spacing.two },
});
