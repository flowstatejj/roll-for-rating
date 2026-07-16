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
import { fetchNotifications, localizeNotification, markAllRead as markAllReadServer, markRead } from '@/lib/notifications';
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
  if (type === 'message' || type === 'league_message') return 'messages';
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
    case 'video': return 'videocam';
    case 'league_matchup': return 'people-circle';
    case 'league_message': return 'megaphone';
    case 'gym_request': return 'people';
    case 'tournament_invite': return 'trophy';
    case 'league_invite': return 'people-circle';
    case 'friend_request': return 'person-add';
    case 'friend_accepted': return 'people';
    case 'affiliate': return 'cash';
    case 'gym_account': return 'business';
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

  // Reading is an ACTION now, not a side effect of glancing at a tab: a
  // notification moves to the Read area when tapped (or via Mark all read).

  const unreadByTab = useMemo(() => {
    const m: Record<NotifTab, number> = { challenges: 0, messages: 0, friends: 0, cancelled: 0 };
    for (const n of items) if (!n.read) m[tabFor(n.type)] += 1;
    return m;
  }, [items]);

  const totalUnread = unreadByTab.challenges + unreadByTab.messages + unreadByTab.friends + unreadByTab.cancelled;

  function markAllRead() {
    const unread = itemsRef.current.filter((n) => !n.read);
    if (unread.length === 0) return;
    setItems((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
    // Server-side unbounded: also clears unread rows beyond the 50 loaded here,
    // so the bell badge can never strand on older unloadable notifications.
    markAllReadServer(userId).catch(() => {});
  }

  const visible = useMemo(() => items.filter((n) => tabFor(n.type) === tab), [items, tab]);

  // Spammy per-event types collapse into one row per conversation/match; the
  // row shows the newest item, how many it stands for, and every id it covers
  // (so opening the row can mark the whole group read).
  type Row = { key: string; latest: AppNotification; count: number; unread: boolean; ids: string[] };
  const rows = useMemo(() => {
    const groupable = new Set(['reaction', 'message', 'league_message']);
    const byKey = new Map<string, Row>();
    const out: Row[] = [];
    for (const n of visible) {
      const key = groupable.has(n.type) ? `${n.type}:${n.match_id ?? n.data?.lid ?? 'x'}` : n.id;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        existing.unread = existing.unread || !n.read;
        existing.ids.push(n.id);
      } else {
        const row: Row = { key, latest: n, count: 1, unread: !n.read, ids: [n.id] };
        byKey.set(key, row);
        out.push(row); // `visible` is newest-first, so `latest` is the newest
      }
    }
    return out;
  }, [visible]);

  // Unread stays front and center; read rows collapse into a Read area below.
  const unreadRows = useMemo(() => rows.filter((r) => r.unread), [rows]);
  const readRows = useMemo(() => rows.filter((r) => !r.unread), [rows]);
  const [showRead, setShowRead] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  useEffect(() => { setShowRead(false); setShowOlder(false); }, [tab]);

  // Day sections; the read area additionally gates 14-day-old items.
  function buildSections(list: Row[], gateOld: boolean) {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = startOfDay(new Date());
    const yesterday = today - 86400000;
    const cutoff = today - 14 * 86400000;
    const buckets: { titleKey: string; rows: Row[] }[] = [
      { titleKey: 'notif.today', rows: [] },
      { titleKey: 'notif.yesterday', rows: [] },
      { titleKey: 'notif.earlier', rows: [] },
    ];
    let hiddenOlder = 0;
    for (const r of list) {
      const ts = new Date(r.latest.created_at).getTime();
      if (ts >= today) buckets[0].rows.push(r);
      else if (ts >= yesterday) buckets[1].rows.push(r);
      else if (ts >= cutoff || !gateOld || showOlder) buckets[2].rows.push(r);
      else hiddenOlder += 1;
    }
    return { buckets: buckets.filter((b) => b.rows.length > 0), hiddenOlder };
  }
  const unreadSections = useMemo(() => buildSections(unreadRows, false), [unreadRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const readSections = useMemo(() => buildSections(readRows, true), [readRows, showOlder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Title/body for a row; grouped rows get their own honest phrasing.
  function rowText(row: Row): { title: string; body: string | null } {
    const { title, body } = localizeNotification(row.latest, t);
    if (row.count <= 1) return { title, body };
    if (row.latest.type === 'reaction') {
      return {
        title: t('notif.gReactions')
          .replace('{name}', row.latest.data?.name ?? '')
          .replace('{n}', String(row.count - 1)),
        body: null,
      };
    }
    return { title, body: t('notif.gMessages').replace('{n}', String(row.count)) };
  }

  // Tapping a row reads it (moves it to the Read area) and opens its target.
  function open(row: Row) {
    if (row.unread) {
      const ids = new Set(row.ids);
      setItems((prev) => prev.map((n) => (ids.has(n.id) && !n.read ? { ...n, read: true } : n)));
      markRead(userId, row.ids).catch(() => {});
    }
    const n = row.latest;
    if (n.match_id) router.push(`/match/${n.match_id}`);
    else if (n.type === 'tournament_invite' && n.data?.tid) router.push(`/tournament/${n.data.tid}`);
    else if ((n.type === 'league_invite' || n.type === 'league_matchup' || n.type === 'league_message') && n.data?.lid) router.push(`/league/${n.data.lid}`);
    else if (n.type === 'friend_accepted' && n.data?.fid) router.push(`/user/${n.data.fid}`);
    else if (n.type === 'friend_request') router.push('/friends');
    else if (n.type === 'gym_request') router.push('/(tabs)/community');
    else if (n.type === 'affiliate') router.push('/affiliate');
    else if (n.type === 'gym_account') router.push('/(tabs)/profile');
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

      {totalUnread > 0 && (
        <Pressable onPress={markAllRead} hitSlop={8} style={{ alignSelf: 'flex-end', paddingVertical: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>{t('notif.markAllRead')}</ThemedText>
        </Pressable>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="notifications-outline" title={t('notif.emptyTitle')} subtitle={t('notif.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.three }}>
          {/* Unread: always fully visible - this is the actionable list. */}
          {unreadRows.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
              {t('notif.caughtUp')}
            </ThemedText>
          ) : (
            unreadSections.buckets.map((b) => (
              <View key={`u-${b.titleKey}`} style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">{t(b.titleKey)}</ThemedText>
                <Card style={{ padding: 0, gap: 0 }}>
                  {b.rows.map((r, i) => renderRow(r, i))}
                </Card>
              </View>
            ))
          )}

          {/* Read: collapsed by default so cleared items stop taking space. */}
          {readRows.length > 0 && !showRead && (
            <Pressable onPress={() => setShowRead(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('notif.showRead').replace('{n}', String(readRows.length))}
              </ThemedText>
            </Pressable>
          )}
          {showRead && readSections.buckets.map((b) => (
            <View key={`r-${b.titleKey}`} style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('notif.readSection')} · {t(b.titleKey)}
              </ThemedText>
              <Card style={{ padding: 0, gap: 0 }}>
                {b.rows.map((r, i) => renderRow(r, i))}
              </Card>
            </View>
          ))}
          {showRead && readSections.hiddenOlder > 0 && !showOlder && (
            <Pressable
              onPress={() => setShowOlder(true)}
              style={[styles.older, { borderColor: theme.tileBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('notif.showOlder')}</ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </Screen>
  );

  function renderRow(r: Row, i: number) {
    const n = r.latest;
    const { title, body } = rowText(r);
    const hasTarget = !!(n.match_id || n.type === 'gym_request' || n.type === 'friend_request'
      || (n.type === 'tournament_invite' && n.data?.tid)
      || (n.type === 'league_invite' && n.data?.lid)
      || (n.type === 'friend_accepted' && n.data?.fid)
      || n.type === 'affiliate' || n.type === 'gym_account');
    return (
      <Pressable key={r.key} onPress={() => open(r)}>
        <View style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.tileBorder }]}>
          <View style={[styles.dot, r.unread && { backgroundColor: theme.accent }]} />
          <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name={iconFor(n.type)} size={16} color={r.unread ? theme.accent : theme.textSecondary} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText style={{ fontWeight: r.unread ? '800' : '600', flex: 1 }} numberOfLines={1}>
                {title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {relative(n.created_at, t)}
              </ThemedText>
            </View>
            {body ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {body}
              </ThemedText>
            ) : null}
          </View>
          {hasTarget && <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />}
        </View>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.one, paddingRight: Spacing.three },
  tab: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  badge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent' },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  older: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
});
