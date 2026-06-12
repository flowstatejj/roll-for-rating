import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Forgot/reset password — code-by-email flow (no deep links, works in review):
 *   1. Enter the account email → Supabase emails a 6-digit code.
 *   2. Enter the code + a new password → verifyOtp signs the user in and the
 *      new password is saved. The root navigator takes over from the session.
 */
export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    if (!email.trim()) {
      Alert.alert(t('fp.error'), t('fp.emailReq'));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setStep('code');
    } catch (e: any) {
      Alert.alert(t('fp.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (code.trim().length < 6) {
      Alert.alert(t('fp.error'), t('fp.codeReq'));
      return;
    }
    if (password.length < 8) {
      Alert.alert(t('fp.error'), t('fp.passwordReq'));
      return;
    }
    setLoading(true);
    try {
      // The code signs the user in; then we set the new password on the session.
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery',
      });
      if (otpErr) throw otpErr;
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      Alert.alert(t('fp.doneTitle'), t('fp.doneBody'));
      // Session is live — the root navigator routes into the app on its own.
    } catch (e: any) {
      Alert.alert(t('fp.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={[styles.logo, { backgroundColor: theme.accent }]}>
            <Ionicons name="key" size={32} color={theme.accentText} />
          </View>
          <ThemedText type="title" style={{ fontSize: 28, textAlign: 'center' }}>
            {t('fp.title')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {step === 'email' ? t('fp.introEmail') : t('fp.introCode').replace('{email}', email.trim())}
          </ThemedText>
        </View>

        {step === 'email' ? (
          <View style={styles.form}>
            <TextField
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <Button label={t('fp.sendCode')} onPress={sendCode} loading={loading} icon="mail" />
          </View>
        ) : (
          <View style={styles.form}>
            <TextField
              label={t('fp.code')}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              placeholder="123456"
            />
            <TextField
              label={t('fp.newPassword')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
            />
            <Button label={t('fp.reset')} onPress={resetPassword} loading={loading} icon="lock-closed" />
            <Button label={t('fp.resend')} variant="ghost" onPress={sendCode} disabled={loading} />
          </View>
        )}

        <Button label={t('fp.backToSignIn')} variant="ghost" onPress={() => router.back()} />
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
  form: { gap: Spacing.three, marginBottom: Spacing.three },
});
