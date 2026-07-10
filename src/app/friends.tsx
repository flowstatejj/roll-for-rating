import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  fetchMyFriendRequests,
  fetchMyFriends,
  fetchMyPendingSentIds,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type FriendProfile,
} from '@/lib/friends';
import { searchProfiles } from '@/lib/matches';
import type { Profile } from '@/lib/types';

type Tab = 'friends' | 'requests' | 'find';

export default function FriendsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [requests, setRequests] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Find tab
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [f, r, sent] = await Promise.all([
        fetchMyFriends(),
        fetchMyFriendRequests(),
        fetchMyPendingSentIds().catch(() => [] as string[]),
      ]);
      setFriends(f);
      setRequests(r);
      // Seed with requests already pending from previous sessions so the Find
      // tab shows "Pending" instead of offering to add the same person again.
      setRequested((s) => new Set([...s, ...sent]));
    } catch (e) {
      console.warn('friends load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (tab !== 'find') return;
    const h = setTimeout(async () => {
      try {
        const exclude = friends.map((f) => f.id);
        if (q.trim()) {
          // Searching: the 5 best matches, anywhere.
          setResults(await searchProfiles(q, exclude, { limit: 5 }));
        } else {
          // Default: people from your gym (nobody if you haven't joined one).
          setResults(profile?.gym_id ? await searchProfiles('', exclude, { gymId: profile.gym_id }) : []);
        }
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(h);
  }, [q, tab, friends, profile?.gym_id]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await load(); }
    catch (e: any) { Alert.alert(t('md.error'), e.message ?? t('md.tryAgain')); }
    finally { setBusy(false); }
  }

  async function addFriend(p: Profile) {
    setRequested((s) => new Set(s).add(p.id));
    try {
      await sendFriendRequest(p.id);
    } catch (e: any) {
      setRequested((s) => { const n = new Set(s); n.delete(p.id); return n; });
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    }
  }

  // Tap the "Pending" chip to withdraw a request you sent (same RPC the
  // profile screen uses for its "Request sent" button).
  async function cancelRequest(p: Profile) {
    setRequested((s) => { const n = new Set(s); n.delete(p.id); return n; });
    try {
      await removeFriend(p.id);
    } catch (e: any) {
      setRequested((s) => new Set(s).add(p.id));
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    }
  }

  function confirmRemove(p: FriendProfile) {
    Alert.alert(t('frn.removeTitle'), t('frn.removeBody').replace('{name}', p.display_name), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('frn.remove'), style: 'destructive', onPress: () => act(() => removeFriend(p.id)) },
    ]);
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('frn.title') }} />

      <View style={styles.segment}>
        <Seg label={t('frn.tabFriends')} badge={friends.length} active={tab === 'friends'} onPress={() => setTab('friends')} />
        <Seg label={t('frn.tabRequests')} badge={requests.length} active={tab === 'requests'} onPress={() => setTab('requests')} />
        <Seg label={t('frn.tabFind')} active={tab === 'find'} onPress={() => setTab('find')} />
      </View>

      {tab === 'friends' && (
        friends.length === 0 ? (
          <EmptyState icon="people-outline" title={t('frn.emptyTitle')} subtitle={t('frn.emptySub')} />
        ) : (
          <View style={{ gap: Spacing.two }}>
            {friends.map((p) => (
              <Card key={p.id} style={styles.row}>
                <Pressable style={styles.rowMain} onPress={() => router.push(`/user/${p.id}`)}>
                  <Avatar name={p.display_name} size={40} warrior={p.avatar_warrior ?? undefined} color={p.avatar_color ?? undefined} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{p.display_name}</ThemedText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                      <BeltChip belt={p.belt_rank as any} size="sm" />
                      <ThemedText type="small" themeColor="textSecondary">@{p.username}</ThemedText>
                    </View>
                  </View>
                </Pressable>
                <Pressable onPress={() => confirmRemove(p)} hitSlop={8} style={{ padding: Spacing.one }}>
                  <Ionicons name="person-remove-outline" size={20} color={theme.textSecondary} />
                </Pressable>
              </Card>
            ))}
          </View>
        )
      )}

      {tab === 'requests' && (
        requests.length === 0 ? (
          <EmptyState icon="mail-outline" title={t('frn.noReqTitle')} subtitle={t('frn.noReqSub')} />
        ) : (
          <View style={{ gap: Spacing.two }}>
            {requests.map((p) => (
              <Card key={p.id} style={{ gap: Spacing.two }}>
                <Pressable style={styles.rowMain} onPress={() => router.push(`/user/${p.id}`)}>
                  <Avatar name={p.display_name} size={40} warrior={p.avatar_warrior ?? undefined} color={p.avatar_color ?? undefined} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{p.display_name}</ThemedText>
                    <BeltChip belt={p.belt_rank as any} size="sm" />
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <View style={{ flex: 1 }}>
                    <Button label={t('frn.accept')} icon="checkmark-circle" loading={busy} onPress={() => act(() => respondFriendRequest(p.id, true))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label={t('frn.decline')} variant="ghost" loading={busy} onPress={() => act(() => respondFriendRequest(p.id, false))} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )
      )}

      {tab === 'find' && (
        <View style={{ gap: Spacing.two }}>
          <TextField value={q} onChangeText={setQ} placeholder={t('frn.searchPh')} autoCapitalize="none" autoCorrect={false} />
          {!q.trim() && results.length > 0 && (
            <ThemedText type="smallBold" themeColor="textSecondary">{t('frn.fromYourGym')}</ThemedText>
          )}
          {results.length === 0 ? (
            <EmptyState icon="search-outline" title={t('frn.findTitle')} subtitle={t('frn.findSub')} />
          ) : (
            results.slice(0, 15).map((p) => {
              const sent = requested.has(p.id);
              return (
                <Card key={p.id} style={styles.row}>
                  <Pressable style={styles.rowMain} onPress={() => router.push(`/user/${p.id}`)}>
                    <Avatar name={p.display_name} size={40} warrior={p.avatar_warrior} color={p.avatar_color} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText style={{ fontWeight: '800' }} numberOfLines={1}>{p.display_name}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                        <BeltChip belt={p.belt_rank} size="sm" />
                        <ThemedText type="small" themeColor="textSecondary">@{p.username}</ThemedText>
                      </View>
                    </View>
                  </Pressable>
                  {sent ? (
                    <Pressable
                      onPress={() => cancelRequest(p)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('frn.cancelRequest')}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one }}>
                      <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
                      <ThemedText type="small" themeColor="textSecondary">{t('frn.pending')}</ThemedText>
                      <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
                    </Pressable>
                  ) : (
                    <Button label={t('frn.add')} icon="person-add" variant="secondary" onPress={() => addFriend(p)} />
                  )}
                </Card>
              );
            })
          )}
        </View>
      )}
    </Screen>
  );
}

function Seg({ label, badge, active, onPress }: { label: string; badge?: number; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.seg, { backgroundColor: active ? theme.accent : 'transparent' }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700' }}>
        {label}{badge ? ` (${badge})` : ''}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: 'rgba(127,127,127,0.15)', borderRadius: 10, padding: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
