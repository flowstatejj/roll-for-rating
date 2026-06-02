import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchNotifications, markAllRead } from '@/lib/notifications';
import type { AppNotification } from '@/lib/types';

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

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications(userId);
      setItems(data);
      // Clear the badge after showing them.
      if (data.some((n) => !n.read)) markAllRead(userId).catch(() => {});
    } catch (e) {
      console.warn('notifications failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function open(n: AppNotification) {
    if (n.match_id) router.push(`/match/${n.match_id}`);
    else if (n.type === 'gym_request') router.push('/(tabs)/community');
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.notifications') }} />

      {items.length === 0 ? (
        <EmptyState icon="notifications-outline" title={t('notif.emptyTitle')} subtitle={t('notif.emptySub')} />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {items.map((n) => (
            <Pressable key={n.id} onPress={() => open(n)}>
              <Card style={[styles.row, !n.read && { borderColor: theme.accent, borderWidth: 1 }]}>
                <View style={[styles.icon, { backgroundColor: n.read ? theme.backgroundSelected : theme.accent }]}>
                  <Ionicons name={iconFor(n.type)} size={18} color={n.read ? theme.text : theme.accentText} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <ThemedText style={{ fontWeight: '800', flex: 1 }} numberOfLines={1}>
                      {n.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {relative(n.created_at, t)}
                    </ThemedText>
                  </View>
                  {n.body ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {n.body}
                    </ThemedText>
                  ) : null}
                </View>
                {(n.match_id || n.type === 'gym_request') && (
                  <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                )}
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
