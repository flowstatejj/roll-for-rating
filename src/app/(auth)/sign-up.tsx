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

/** Validate MM/DD/YYYY parts and return the ISO date + current age, or null. */
function parseDob(mm: string, dd: string, yyyy: string): { iso: string; age: number } | null {
  const m = Number(mm);
  const d = Number(dd);
  const y = Number(yyyy);
  if (!mm || !dd || yyyy.length !== 4) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  const date = new Date(y, m - 1, d);
  // Reject impossible dates (e.g. Feb 30 rolls over).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  const iso = `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d
    .toString()
    .padStart(2, '0')}`;
  return { iso, age };
}

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const theme = useTheme();
  const router = useRouter();

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
              Date of birth
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

          {isMinor && (
            <View style={{ gap: Spacing.one }}>
              <TextField
                label="Parent / guardian email"
                value={parentEmail}
                onChangeText={setParentEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="parent@example.com"
              />
              <ThemedText type="small" themeColor="textSecondary">
                {isKid
                  ? "Under 14: we'll email your parent/guardian to approve the account. Until then it stays locked. No wagering, not publicly searchable, and matches stay within your own gym."
                  : "Under 18: we'll email your parent/guardian a link to approve the account. Once approved you can match anyone and appear on leaderboards — wagering stays adults-only."}
              </ThemedText>
            </View>
          )}

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
  dobRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  beltOption: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: 1,
  },
  footer: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center', marginTop: Spacing.two },
});
