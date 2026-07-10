import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export default function CommunityScreen() {
  const { profile, refreshProfile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
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
        {t('tab.community')}
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
                {t('comm.yourGym')}
              </ThemedText>
              <ThemedText style={{ fontSize: 18, fontWeight: '800' }} numberOfLines={1}>
                {gymName ?? t('comm.yourGymFallback')}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
          </Card>
        </Pressable>
      ) : (
        <Card style={{ gap: Spacing.three, alignItems: 'center' }}>
          <Ionicons name="barbell-outline" size={36} color={theme.textSecondary} />
          <ThemedText style={{ fontWeight: '700', textAlign: 'center' }}>
            {t('comm.noGymTitle')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {t('comm.noGymSub')}
          </ThemedText>
          <Button label={t('comm.findCreateGym')} icon="add-circle" onPress={() => router.push('/gyms')} />
        </Card>
      )}

      {/* Compete */}
      <LinkSection
        title={t('comm.compete')}
        links={[
          { icon: 'flame', label: t('nav.findRoll'), onPress: () => router.push('/find') },
          { icon: 'people-circle', label: t('nav.leagues'), onPress: () => router.push('/leagues') },
          { icon: 'trophy', label: t('nav.tournaments'), onPress: () => router.push('/tournaments') },
          { icon: 'lock-open', label: t('nav.submissionHunt'), onPress: () => router.push('/submission-hunt') },
          { icon: 'checkbox', label: t('nav.quests'), onPress: () => router.push('/quests') },
        ]}
      />

      {/* Explore */}
      <LinkSection
        title={t('comm.explore')}
        links={[
          { icon: 'podium', label: t('lb.title'), onPress: () => router.push('/(tabs)/leaderboard') },
          { icon: 'calendar', label: t('nav.openMats'), onPress: () => router.push('/open-mats') },
          { icon: 'cash', label: t('nav.biggestPots'), onPress: () => router.push('/high-rollers') },
          { icon: 'play-circle', label: t('nav.watch'), onPress: () => router.push('/watch') },
        ]}
      />
    </Screen>
  );
}

type LinkItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

function LinkSection({ title, links }: { title: string; links: LinkItem[] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold" themeColor="textSecondary">{title}</ThemedText>
      <Card style={{ paddingVertical: Spacing.one }}>
        {links.map((l, i) => (
          <View key={l.label}>
            {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
            <Pressable onPress={l.onPress} style={styles.linkRow}>
              <Ionicons name={l.icon} size={20} color={theme.textSecondary} />
              <ThemedText style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
                {l.label}
              </ThemedText>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  gymCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  gymIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
});
