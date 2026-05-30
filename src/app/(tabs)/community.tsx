import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function CommunityScreen() {
  const { profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const [gymName, setGymName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    await refreshProfile();
    setLoading(false);
  }, [refreshProfile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Resolve the current gym's name for the header card.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!profile?.gym_id) {
        setGymName(null);
        return;
      }
      supabase
        .from('gyms')
        .select('name')
        .eq('id', profile.gym_id)
        .single()
        .then(({ data }) => {
          if (active) setGymName((data as { name: string } | null)?.name ?? null);
        });
      return () => {
        active = false;
      };
    }, [profile?.gym_id]),
  );

  if (loading || !profile) return <Loading />;

  return (
    <Screen>
      <ThemedText type="subtitle" style={{ fontSize: 28 }}>
        Community
      </ThemedText>

      {/* My gym */}
      {profile.gym_id ? (
        <Pressable onPress={() => router.push(`/gym/${profile.gym_id}`)}>
          <Card style={styles.gymCard}>
            <View style={[styles.gymIcon, { backgroundColor: theme.accent }]}>
              <Ionicons name="barbell" size={24} color={theme.accentText} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="small" themeColor="textSecondary">
                YOUR GYM
              </ThemedText>
              <ThemedText style={{ fontSize: 18, fontWeight: '800' }} numberOfLines={1}>
                {gymName ?? 'Your gym'}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
          </Card>
        </Pressable>
      ) : (
        <Card style={{ gap: Spacing.three, alignItems: 'center' }}>
          <Ionicons name="barbell-outline" size={36} color={theme.textSecondary} />
          <ThemedText style={{ fontWeight: '700', textAlign: 'center' }}>
            You haven&apos;t joined a gym yet
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            Join your academy to find teammates and challenge rivals.
          </ThemedText>
          <Button label="Find or create a gym" icon="add-circle" onPress={() => router.push('/gyms')} />
        </Card>
      )}

      {/* Actions */}
      <ActionRow
        icon="play-circle"
        title="Watch"
        subtitle="Public matches — view counts and reactions"
        onPress={() => router.push('/watch')}
      />
      <ActionRow
        icon="flame"
        title="Find a roll"
        subtitle="Your gym network, or anyone open for a challenge nearby"
        onPress={() => router.push('/find')}
      />
      <ActionRow
        icon="podium"
        title="Rankings"
        subtitle="The global leaderboard"
        onPress={() => router.push('/(tabs)/leaderboard')}
      />
      <ActionRow
        icon="calendar"
        title="Open mats"
        subtitle="Find and post local open mat sessions"
        onPress={() => router.push('/open-mats')}
      />
      <ActionRow
        icon="checkbox"
        title="Quests"
        subtitle="Weekly challenges + your daily streak"
        onPress={() => router.push('/quests')}
      />
      <ActionRow
        icon="calendar-number"
        title="Seasons"
        subtitle="The seasonal points race + champions"
        onPress={() => router.push('/seasons')}
      />
      <ActionRow
        icon="lock-open"
        title="Submission Hunt"
        subtitle="Collect submissions for bonus Elo"
        onPress={() => router.push('/submission-hunt')}
      />
      <ActionRow
        icon="cash"
        title="Biggest Pots"
        subtitle="High rollers — most Elo won via wagers"
        onPress={() => router.push('/high-rollers')}
      />
      <ActionRow
        icon="search"
        title="Browse gyms"
        subtitle="Explore academies and switch gyms"
        onPress={() => router.push('/gyms')}
      />
    </Screen>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.45 : 1 }}>
      <Card style={styles.actionRow}>
        <View style={[styles.actionIcon, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={icon} size={22} color={theme.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText style={{ fontWeight: '800', fontSize: 16 }}>{title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gymCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  gymIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  actionIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
