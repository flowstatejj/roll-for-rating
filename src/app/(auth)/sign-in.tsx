import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LAST_EMAIL_KEY, useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Pre-fill the last email used so a returning user only enters a password.
  useEffect(() => {
    AsyncStorage.getItem(LAST_EMAIL_KEY)
      .then((v) => { if (v) setEmail(v); })
      .catch(() => {});
  }, []);

  async function onSubmit() {
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      // The root navigator redirects to the tabs once the session lands.
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={[styles.logo, { backgroundColor: theme.accent }]}>
            <Ionicons name="trophy" size={32} color={theme.accentText} />
          </View>
          <ThemedText type="title" style={styles.brand}>
            Roll for Rating
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {t('auth.tagline')}
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <TextField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            placeholder="••••••••"
          />
          <Button label={t('auth.signIn')} onPress={onSubmit} loading={loading} />

          <View style={styles.footer}>
            <Link href="/(auth)/forgot-password">
              <ThemedText style={{ color: theme.accent, fontWeight: '700' }}>
                {t('auth.forgotPassword')}
              </ThemedText>
            </Link>
          </View>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">{t('auth.newHere')}</ThemedText>
            <Link href="/(auth)/sign-up">
              <ThemedText style={{ color: theme.accent, fontWeight: '700' }}>
                {t('auth.createAccount')}
              </ThemedText>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  brand: { fontSize: 34, textAlign: 'center' },
  form: { gap: Spacing.three },
  footer: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center', marginTop: Spacing.two },
});
