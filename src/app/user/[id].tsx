import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { SocialLinks } from '@/components/social-links';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { avatarSignedUrl } from '@/lib/avatars';
import { useTranslation } from '@/lib/i18n';
import { fetchProfileById } from '@/lib/profiles';
import { amIBlocking, blockUser, reportUser, unblockUser } from '@/lib/safety';
import { tierFor } from '@/lib/tiers';
import { fetchChampions, heldTitles, type Champion } from '@/lib/titles';
import type { Profile } from '@/lib/types';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile: me } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session?.user.id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchProfileById(id)
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        if (p) {
          avatarSignedUrl(p.avatar_path).then((u) => alive && setAvatarUrl(u));
          fetchChampions(p).then((c) => alive && setChampions(c)).catch(() => {});
        }
      })
      .finally(() => alive && setLoading(false));
    if (id !== userId) amIBlocking(id).then((b) => alive && setBlocked(b)).catch(() => {});
    return () => { alive = false; };
  }, [id, userId]);

  async function toggleBlock() {
    setBusy(true);
    try {
      if (blocked) { await unblockUser(id); setBlocked(false); }
      else {
        await blockUser(id);
        setBlocked(true);
        Alert.alert(t('sf.blockedTitle'), t('sf.blockedBody'));
      }
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally { setBusy(false); }
  }

  function confirmBlock() {
    if (blocked) { toggleBlock(); return; }
    Alert.alert(t('sf.blockConfirmTitle'), t('sf.blockConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sf.block'), style: 'destructive', onPress: toggleBlock },
    ]);
  }

  function reportFlow() {
    const reasons: { key: string; label: string }[] = [
      { key: 'harassment', label: t('sf.rHarass') },
      { key: 'inappropriate', label: t('sf.rInappropriate') },
      { key: 'spam', label: t('sf.rSpam') },
      { key: 'other', label: t('sf.rOther') },
    ];
    Alert.alert(t('sf.reportTitle'), t('sf.reportBody'), [
      ...reasons.map((r) => ({
        text: r.label,
        onPress: async () => {
          try {
            await reportUser({ reportedUserId: id, reason: r.key });
            Alert.alert(t('sf.reportedTitle'), t('sf.reportedBody'));
          } catch (e: any) {
            Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
          }
        },
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  if (loading) return <Loading />;

  if (!profile) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="person-outline" title={t('up.notFound')} subtitle="" />
      </Screen>
    );
  }

  const isMe = profile.id === userId;
  const isMyJunior = profile.managed_by === userId;
  // A 13-and-under account is private to everyone but the kid and their guardian.
  const isProtectedKid = profile.age_tier === 'kid' && !isMe && !isMyJunior;

  if (isProtectedKid) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <Card style={styles.protected}>
          <Ionicons name="shield-checkmark" size={28} color={theme.accent} />
          <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{t('up.protected')}</ThemedText>
          <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>{t('up.protectedSub')}</ThemedText>
        </Card>
      </Screen>
    );
  }

  const total = profile.wins + profile.losses + profile.draws;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
  const tier = tierFor(profile.rating);
  const titles = heldTitles(champions);
  const memberSince = new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const canChallenge = !isMe && !profile.is_minor && !blocked;

  return (
    <Screen>
      <Stack.Screen options={{ title: profile.display_name }} />

      {/* Header */}
      <Card style={styles.header}>
        <Avatar name={profile.display_name} size={72} uri={avatarUrl} warrior={profile.avatar_warrior} color={profile.avatar_color} />
        <View style={{ flex: 1, gap: 4 }}>
          <ThemedText style={{ fontSize: 22, fontWeight: '800' }} numberOfLines={1}>
            {profile.display_name}
          </ThemedText>
          <ThemedText themeColor="textSecondary">@{profile.username}</ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <BeltChip belt={profile.belt_rank} size="sm" />
            <ThemedText type="small" themeColor="textSecondary">
              {t('up.since')} {memberSince}
            </ThemedText>
          </View>
        </View>
      </Card>

      {/* Social links (adults only) */}
      {!profile.is_minor && (profile.instagram || profile.tiktok || profile.youtube || profile.facebook) && (
        <View style={styles.socialDisplay}>
          <ThemedText type="small" themeColor="textSecondary">{t('pf.findMe')}</ThemedText>
          <SocialLinks links={profile} />
        </View>
      )}

      {/* Held titles */}
      {titles.length > 0 && (
        <View style={styles.titleRow}>
          {titles.map((title) => (
            <View key={title} style={[styles.titleChip, { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]}>
              <ThemedText style={{ fontSize: 13 }}>👑</ThemedText>
              <ThemedText style={{ color: theme.accent, fontWeight: '800', fontSize: 13 }}>{title}</ThemedText>
            </View>
          ))}
        </View>
      )}

      {/* Rating panel */}
      <Card style={{ backgroundColor: theme.accent }}>
        <ThemedText style={{ color: theme.accentText, opacity: 0.85, fontWeight: '700' }}>{t('up.rating')}</ThemedText>
        <ThemedText style={{ color: theme.accentText, fontSize: 52, fontWeight: '800', lineHeight: 56 }}>
          {profile.rating}
        </ThemedText>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.one }}>
          <ThemedText style={{ color: theme.accentText, fontWeight: '800' }}>{t(`tier.${tier.tier.key}`)}</ThemedText>
          {profile.city ? (
            <ThemedText type="small" style={{ color: theme.accentText, opacity: 0.85 }}>{profile.city}</ThemedText>
          ) : null}
        </View>
        <View style={styles.recordRow}>
          <MiniStat label={t('up.wins')} value={profile.wins} tint={theme.accentText} />
          <MiniStat label={t('up.losses')} value={profile.losses} tint={theme.accentText} />
          <MiniStat label={t('up.draws')} value={profile.draws} tint={theme.accentText} />
          <MiniStat label={t('up.winPct')} value={`${winRate}%`} tint={theme.accentText} />
        </View>
      </Card>

      {canChallenge && (
        <Button label={t('find.challenge')} icon="flame" onPress={() => router.push(`/match/new?opponent=${profile.id}`)} />
      )}

      {/* Trust & safety: block / report (not on your own profile) */}
      {!isMe && (
        <View style={{ gap: Spacing.two, marginTop: Spacing.two }}>
          <Button
            label={blocked ? t('sf.unblock') : t('sf.block')}
            icon={blocked ? 'lock-open-outline' : 'ban-outline'}
            variant="ghost"
            loading={busy}
            onPress={confirmBlock}
          />
          <Button label={t('sf.report')} icon="flag-outline" variant="ghost" onPress={reportFlow} />
        </View>
      )}
    </Screen>
  );
}

function MiniStat({ label, value, tint }: { label: string; value: string | number; tint: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <ThemedText style={{ color: tint, fontSize: 18, fontWeight: '800' }}>{value}</ThemedText>
      <ThemedText style={{ color: tint, opacity: 0.85, fontSize: 12 }}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  socialDisplay: { alignItems: 'center', gap: Spacing.two },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  titleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 4 },
  recordRow: { flexDirection: 'row', marginTop: Spacing.three },
  protected: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
