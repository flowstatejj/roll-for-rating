import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  fetchGym,
  fetchGymFriends,
  fetchGymMembers,
  fetchOwnedGymId,
  joinGym,
  leaveGym,
  requestGymFriendship,
  respondGymFriendship,
} from '@/lib/social';
import type { GymFriend, GymWithMeta, Profile } from '@/lib/types';

export default function GymDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, refreshProfile } = useAuth();
  const theme = useTheme();
  const userId = session!.user.id;

  const [gym, setGym] = useState<GymWithMeta | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
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
      if (done) Alert.alert('Done', done);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Try again.');
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
              {gym.member_count} member{gym.member_count === 1 ? '' : 's'}
            </ThemedText>
          </View>
        </View>
        {gym.description ? <ThemedText themeColor="textSecondary">{gym.description}</ThemedText> : null}
      </Card>

      {/* Membership */}
      {gym.is_member ? (
        <Button label="Leave this gym" variant="ghost" icon="exit-outline" loading={busy} onPress={() => act(() => leaveGym(userId))} />
      ) : (
        <Button label="Join this gym" icon="add-circle" loading={busy} onPress={() => act(() => joinGym(userId, gym.id), `Welcome to ${gym.name}!`)} />
      )}

      {canRequestFriend && (
        <Button
          label="Request gym friendship"
          variant="secondary"
          icon="git-merge"
          loading={busy}
          onPress={() => act(() => requestGymFriendship(gym.id), 'Request sent to the gym owner.')}
        />
      )}

      {/* Owner: gym friends management */}
      {gym.is_owner && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText style={styles.section}>Gym friends</ThemedText>
          {friends.length === 0 ? (
            <Card style={{ alignItems: 'center' }}>
              <ThemedText themeColor="textSecondary">No gym friendships yet.</ThemedText>
            </Card>
          ) : (
            friends.map((f) => (
              <Card key={f.friendship_id} style={styles.friendRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }}>{f.gym.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {f.status === 'accepted' ? 'Friends' : f.incoming ? 'Wants to connect' : 'Request sent'}
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
      <ThemedText style={styles.section}>Members</ThemedText>
      {members.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <ThemedText themeColor="textSecondary">No members yet.</ThemedText>
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
                    {p.id === gym.owner_id ? ' · owner' : ''}
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
