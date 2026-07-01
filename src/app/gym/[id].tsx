import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  fetchGym,
  fetchGymFriends,
  fetchGymMembers,
  fetchOwnedGymId,
  joinGym,
  leaveGym,
  requestGymFriendship,
  respondGymFriendship,
  type GymMember,
} from '@/lib/social';
import type { GymFriend, GymWithMeta } from '@/lib/types';

export default function GymDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [gym, setGym] = useState<GymWithMeta | null>(null);
  const [members, setMembers] = useState<GymMember[]>([]);
  const [ownedGymId, setOwnedGymId] = useState<string | null>(null);
  const [friends, setFriends] = useState<GymFriend[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [g, m, owned] = await Promise.all([
        fetchGym(id, userId),
        fetchGymMembers(id),
        fetchOwnedGymId(userId),
      ]);
      setGym(g);
      setMembers(m);
      setOwnedGymId(owned);
      if (g.is_owner) setFriends(await fetchGymFriends(id));
    } catch (e) {
      console.warn('load gym failed', e);
    }
  }, [id, userId]);

  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    try {
      await fn();
      await refreshProfile();
      await load();
      if (done) Alert.alert(t('md.done'), done);
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  if (!gym) return <Loading />;

  const canRequestFriend = !gym.is_owner && !!ownedGymId && ownedGymId !== gym.id;

  return (
    <Screen>
      <Stack.Screen options={{ title: gym.name }} />

      {/* Header */}
      <Card style={{ gap: Spacing.two }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <View style={[styles.logo, { backgroundColor: theme.accent }]}>
            <Ionicons name="barbell" size={28} color={theme.accentText} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontSize: 22, fontWeight: '800' }}>{gym.name}</ThemedText>
            {gym.city ? <ThemedText themeColor="textSecondary">{gym.city}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">
              {gym.member_count} {gym.member_count === 1 ? t('gd.member') : t('gd.members')}
            </ThemedText>
          </View>
        </View>
        {gym.description ? <ThemedText themeColor="textSecondary">{gym.description}</ThemedText> : null}
      </Card>

      {/* Membership */}
      {gym.is_member ? (
        <Button label={t('gd.leave')} variant="ghost" icon="exit-outline" loading={busy} onPress={() => act(() => leaveGym(userId))} />
      ) : (
        <Button label={t('gd.join')} icon="add-circle" loading={busy} onPress={() => act(() => joinGym(userId, gym.id), t('gd.welcome').replace('{name}', gym.name))} />
      )}

      {canRequestFriend && (
        <Button
          label={t('gd.requestFriend')}
          variant="secondary"
          icon="git-merge"
          loading={busy}
          onPress={() => act(() => requestGymFriendship(gym.id), t('gd.requestSent'))}
        />
      )}

      {/* Owner: gym friends management */}
      {gym.is_owner && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText style={styles.section}>{t('gd.gymFriends')}</ThemedText>
          {friends.length === 0 ? (
            <Card style={{ alignItems: 'center' }}>
              <ThemedText themeColor="textSecondary">{t('gd.noFriends')}</ThemedText>
            </Card>
          ) : (
            friends.map((f) => (
              <Card key={f.friendship_id} style={styles.friendRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }}>{f.gym.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {f.status === 'accepted' ? t('gd.friends') : f.incoming ? t('gd.wantsConnect') : t('gd.reqSent')}
                  </ThemedText>
                </View>
                {f.status === 'pending' && f.incoming && (
                  <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                    <Ionicons name="checkmark-circle" size={28} color={theme.success} onPress={() => act(() => respondGymFriendship(f.friendship_id, true))} />
                    <Ionicons name="close-circle" size={28} color={theme.danger} onPress={() => act(() => respondGymFriendship(f.friendship_id, false))} />
                  </View>
                )}
                {f.status === 'accepted' && <Ionicons name="git-merge" size={20} color={theme.accent} />}
              </Card>
            ))
          )}
        </View>
      )}

      {/* Members */}
      <ThemedText style={styles.section}>{t('gd.membersTitle')}</ThemedText>
      {members.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <ThemedText themeColor="textSecondary">{t('gd.noMembers')}</ThemedText>
        </Card>
      ) : (
        <Card style={{ paddingVertical: Spacing.one }}>
          {members.map((p, i) => (
            <View key={p.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <View style={styles.memberRow}>
                <Avatar name={p.display_name} size={36} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {p.display_name}
                    {p.id === gym.owner_id ? ` · ${t('gd.ownerSuffix')}` : ''}
                  </ThemedText>
                  <BeltChip belt={p.belt_rank} size="sm" />
                </View>
                <ThemedText style={{ fontWeight: '800' }}>{p.rating}</ThemedText>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
});
