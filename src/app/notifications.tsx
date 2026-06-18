import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchNotifications, localizeNotification, markRead } from '@/lib/notifications';
import type { AppNotification } from '@/lib/types';

type NotifTab = 'challenges' | 'messages' | 'friends' | 'cancelled';

// Order: challenges + messages first; challenges is the default and the catch-all.
const TABS: { key: NotifTab; labelKey: string }[] = [
  { key: 'challenges', labelKey: 'notif.tabChallenges' },
  { key: 'messages', labelKey: 'notif.tabMessages' },
  { key: 'friends', labelKey: 'notif.tabFriends' },
  { key: 'cancelled', labelKey: 'notif.tabCancelled' },
];

// Every notification type maps to exactly one tab. Match/competition activity
// (challenges, results, referee, reactions, invites, gym requests) falls into
// the default "challenges" bucket; the other three are specific carve-outs.
function tabFor(type: string): NotifTab {
  if (type === 'message') return 'messages';
  if (type === 'friend_request' || type === 'friend_accepted') return 'friends';
  if (type === 'cancelled') return 'cancelled';
  return 'challenges';
}

function iconFor(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'challenge': return 'flame';
    case 'accepted': return 'checkmark-circle';
    case 'declined': return 'close-circle';
    case 'cancelled': return 'ban';
    case 'referee': return 'eye';
    case 'result': return 'trophy';
    case 'reaction': return 'heart';
    case 'message': return 'chatbubble';
    case 'gym_request': return 'people';
    case 'tournament_invite': return 'trophy';
    case 'league_invite': return 'people-circle';
    case 'friend_request': return 'person-add';
    case 'friend_accepted': return 'people';
    default: return 'notifications';
  }
}

function relative(iso: string, t: (k: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('notif.justNow');
  if (m < 60) return t('notif.minAgo').replace('{n}', String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return t('notif.hAgo').replace('{n}', String(h));
  const d = Math.floor(h / 24);
  return t('notif.dAgo').replace('{n}', String(d));
}

export default function NotificationsScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<NotifTab>('challenges');

  // Latest items, read without retriggering the mark-read effect.
  const itemsRef = useRef<AppNotification[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNotifications(userId));
    } catch (e) {
      console.warn('notifications failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Mark a tab's notifications read once it's shown — clears the bell badge for
  // exactly what the user actually looked at, and drops that tab's red dot.
  const markViewed = useCallback((which: NotifTab) => {
    const unread = itemsRef.current.filter((n) => !n.read && tabFor(n.type) === which);
    if (unread.length === 0) return;
    const ids = new Set(unread.map((n) => n.id));
    setItems((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, read: true } : n)));
    markRead(userId, [...ids]).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!loading) markViewed(tab);
  }, [tab, loading, markViewed]);

  const unreadByTab = useMemo(() => {
    const m: Record<NotifTab, number> = { challenges: 0, messages: 0, friends: 0, cancelled: 0 };
    for (const n of items) if (!n.read) m[tabFor(n.type)] += 1;
    return m;
  }, [items]);

  const visible = useMemo(() => items.filter((n) => tabFor(n.type) === tab), [items, tab]);

  function open(n: AppNotification) {
    if (n.match_id) router.push(`/match/${n.match_id}`);
    else if (n.type === 'tournament_invite' && n.data?.tid) router.push(`/tournament/${n.data.tid}`);
    else if (n.type === 'league_invite' && n.data?.lid) router.push(`/league/${n.data.lid}`);
    else if (n.type === 'friend_accepted' && n.data?.fid) router.push(`/user/${n.data.fid}`);
    else if (n.type === 'friend_request') router.push('/friends');
    else if (n.type === 'gym_request') router.push('/(tabs)/community');
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.notifications') }} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        style={{ flexGrow: 0 }}>
        {TABS.map((tb) => {
          const active = tab === tb.key;
          const count = unreadByTab[tb.key];
          return (
            <Pressable
              key={tb.key}
              onPress={() => setTab(tb.key)}
              style={[
                styles.tab,
                { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder },
              ]}>
              <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>
                {t(tb.labelKey)}
              </ThemedText>
              {count > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.danger }]}>
                  <ThemedText style={{ color: '#fff', fontWeight: '800', fontSize: 10 }}>
                    {count > 9 ? '9+' : count}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {visible.length === 0 ? (
        <EmptyState icon="notifications-outline" title={t('notif.emptyTitle')} subtitle={t('notif.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {visible.map((n) => {
            const { title, body } = localizeNotification(n, t);
            return (
              <Pressable key={n.id} onPress={() => open(n)}>
                <Card style={[styles.row, !n.read && { borderColor: theme.accent, borderWidth: 1 }]}>
                  <View style={[styles.icon, { backgroundColor: n.read ? theme.backgroundSelected : theme.accent }]}>
                    <Ionicons name={iconFor(n.type)} size={18} color={n.read ? theme.text : theme.accentText} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                      <ThemedText style={{ fontWeight: '800', flex: 1 }} numberOfLines={1}>
                        {title}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {relative(n.created_at, t)}
                      </ThemedText>
                    </View>
                    {body ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                        {body}
                      </ThemedText>
                    ) : null}
                  </View>
                  {(n.match_id || n.type === 'gym_request' || n.type === 'friend_request'
                    || (n.type === 'tournament_invite' && n.data?.tid)
                    || (n.type === 'league_invite' && n.data?.lid)
                    || (n.type === 'friend_accepted' && n.data?.fid)) && (
                    <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                  )}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one, paddingRight: Spacing.three },
  tab: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  badge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
