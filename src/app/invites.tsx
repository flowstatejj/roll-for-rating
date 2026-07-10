import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import { cancelMatchRequest, fetchMatchRequests, respondMatchRequest, type MatchRequest } from '@/lib/invites';

const STATUS_KEY: Record<MatchRequest['status'], string> = {
  pending: 'inv.pending',
  accepted: 'inv.accepted',
  declined: 'inv.declined',
  cancelled: 'inv.cancelled',
};

export default function InvitesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [requests, setRequests] = useState<MatchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showOlder, setShowOlder] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchMatchRequests());
    } catch (e) {
      console.warn('load challenges failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  const incoming = requests.filter((r) => r.direction === 'incoming' && r.status === 'pending');
  const others = requests.filter((r) => !(r.direction === 'incoming' && r.status === 'pending'));

  // Challenges older than two weeks stay reachable behind "Show older".
  const cutoff = Date.now() - 14 * 86400000;
  const shownOthers = showOlder ? others : others.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  const hiddenOlder = others.length - shownOthers.length;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('profile.juniorChallenges') }} />

      {requests.length === 0 ? (
        <EmptyState icon="mail-outline" title={t('inv.emptyTitle')} subtitle={t('inv.emptySub')} />
      ) : (
        <>
          {incoming.length > 0 && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>{t('inv.needsResponse')}</ThemedText>
              <Card style={{ paddingVertical: Spacing.one }}>
                {incoming.map((r, i) => (
                  <View key={r.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                    <View style={{ gap: Spacing.two, paddingVertical: Spacing.two }}>
                      <ThemedText style={{ fontWeight: '800' }}>
                        {r.other_first} ({r.other_rating}) {t('inv.challengedMid')} {r.my_junior_first}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t('inv.acceptNote')}
                      </ThemedText>
                      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                        <View style={{ flex: 1 }}>
                          <Button label={t('md.acceptBtn')} icon="checkmark-circle" loading={busy} onPress={() => act(() => respondMatchRequest(r.id, true))} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button label={t('md.decline')} variant="danger" loading={busy} onPress={() => act(() => respondMatchRequest(r.id, false))} />
                        </View>
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          )}

          {others.length > 0 && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t('inv.allChallenges')}</ThemedText>
              {shownOthers.length > 0 && (
                <Card style={{ paddingVertical: Spacing.one }}>
                  {shownOthers.map((r, i) => (
                    <View key={r.id}>
                      {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                      <View style={styles.row}>
                        <Ionicons
                          name={r.direction === 'outgoing' ? 'arrow-up-circle' : 'arrow-down-circle'}
                          size={22}
                          color={theme.textSecondary}
                        />
                        <View style={{ flex: 1 }}>
                          <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                            {r.direction === 'outgoing'
                              ? `${r.my_junior_first} → ${r.other_first}`
                              : `${r.other_first} → ${r.my_junior_first}`}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {t(STATUS_KEY[r.status])} · {t('inv.oppRating')} {r.other_rating}
                          </ThemedText>
                        </View>
                        {/* Host (the challenged side) sets up the match and provides the referee. */}
                        {r.status === 'accepted' && r.direction === 'incoming' && (
                          <Button
                            label={t('inv.setupMatch')}
                            variant="secondary"
                            onPress={() => router.push(`/match/new?opponent=${r.other_id}`)}
                          />
                        )}
                        {r.status === 'accepted' && r.direction === 'outgoing' && (
                          <ThemedText type="small" themeColor="textSecondary" style={{ maxWidth: 140, textAlign: 'right' }}>
                            {t('inv.hostSetsUp')}
                          </ThemedText>
                        )}
                        {r.status === 'pending' && r.direction === 'outgoing' && (
                          <Button label={t('common.cancel')} variant="ghost" loading={busy} onPress={() => act(() => cancelMatchRequest(r.id))} />
                        )}
                      </View>
                    </View>
                  ))}
                </Card>
              )}
              {hiddenOlder > 0 && !showOlder && (
                <Pressable onPress={() => setShowOlder(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
                </Pressable>
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.one },
  older: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
});
