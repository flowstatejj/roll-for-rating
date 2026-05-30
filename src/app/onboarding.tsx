import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const STEPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'flame', title: 'Challenge someone', body: 'Pick an opponent and a referee at the mat — both agree in the app.' },
  { icon: 'eye', title: 'Roll, then the ref records it', body: 'After the roll the referee taps the winner. No claiming your own wins.' },
  { icon: 'trending-up', title: 'Your rating moves', body: 'Climb tiers, win title belts, settle rivalries, and top the leaderboard.' },
];

export default function OnboardingScreen() {
  const { session, markOnboarded } = useAuth();
  const theme = useTheme();
  const router = useRouter();
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
          Welcome to Roll for Rating
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Turn open mats into a ranked ladder. Here&apos;s the gist:
        </ThemedText>
      </View>

      {STEPS.map((s, i) => (
        <Card key={i} style={styles.step}>
          <View style={[styles.stepIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name={s.icon} size={22} color={theme.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={{ fontWeight: '800' }}>{s.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {s.body}
            </ThemedText>
          </View>
        </Card>
      ))}

      <ThemedText style={styles.section}>Set yourself up</ThemedText>
      <Card style={{ gap: Spacing.three }}>
        <TextField label="Your city / area" value={city} onChangeText={setCity} autoCapitalize="words" placeholder="So nearby rollers can find you" />
        <View style={styles.openRow}>
          <Ionicons name="flame" size={20} color={open ? theme.accent : theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>Open for a challenge</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Appear in Find a Roll so people can challenge you.
            </ThemedText>
          </View>
          <Switch value={open} onValueChange={setOpen} trackColor={{ true: theme.accent }} />
        </View>
      </Card>

      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        Tip: join your academy under Community → Browse gyms to find teammates and rivals.
      </ThemedText>

      <Button label="Get started" icon="arrow-forward" loading={busy} onPress={() => finish(true)} />
      <Button label="Skip for now" variant="ghost" onPress={() => finish(false)} />
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
