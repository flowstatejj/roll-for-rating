import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { BELT_COLORS, BELT_LABELS, type BeltRank } from '@/lib/types';

const BELTS: BeltRank[] = ['white', 'blue', 'purple', 'brown', 'black'];

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [belt, setBelt] = useState<BeltRank>('white');
  const [adult, setAdult] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!displayName.trim() || !username.trim() || !email.trim() || !password) {
      Alert.alert('Missing info', 'Please fill in every field.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Use at least 6 characters.');
      return;
    }
    if (adult === null) {
      Alert.alert('One more thing', 'Please tell us your age group.');
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
        isMinor: !adult,
      });
      Alert.alert(
        'Account created',
        'If email confirmation is on, check your inbox to confirm — then sign in.',
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
          Create account
        </ThemedText>

        <View style={styles.form}>
          <TextField label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="Ryan K" />
          <TextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="ryank"
          />
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 6 characters" />

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Belt rank
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
                      {BELT_LABELS[b]}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Age
            </ThemedText>
            <View style={styles.belts}>
              {[
                { label: '18 or older', val: true },
                { label: 'Under 18', val: false },
              ].map((o) => {
                const selected = adult === o.val;
                return (
                  <Pressable
                    key={o.label}
                    onPress={() => setAdult(o.val)}
                    style={[
                      styles.beltOption,
                      { backgroundColor: selected ? theme.accent : theme.backgroundElement, borderColor: selected ? theme.accent : theme.border },
                    ]}>
                    <ThemedText style={{ fontWeight: '700', fontSize: 13, color: selected ? theme.accentText : theme.text }}>
                      {o.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            {adult === false && (
              <ThemedText type="small" themeColor="textSecondary">
                Under-18 accounts are protected: no wagering, not publicly searchable, and matches stay within your gym.
              </ThemedText>
            )}
          </View>

          <Button label="Create account" onPress={onSubmit} loading={loading} />

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">Already have an account?</ThemedText>
            <Link href="/(auth)/sign-in">
              <ThemedText style={{ color: theme.accent, fontWeight: '700' }}>Sign in</ThemedText>
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
  beltOption: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: 1,
  },
  footer: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center', marginTop: Spacing.two },
});
