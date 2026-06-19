import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  dollars, fetchFounderReferrals, fetchReferralOwed, myReferralCode, recordReferralPayout, referralLink,
  type FounderReferrals, type OwedRow,
} from '@/lib/referrals';

export default function AffiliateScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isFounder = !!profile?.is_founding_member;
  const isAdmin = !!profile?.is_admin;

  const [code, setCode] = useState<string | null>(null);
  const [data, setData] = useState<FounderReferrals | null>(null);
  const [owed, setOwed] = useState<OwedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      if (isFounder) {
        const [c, d] = await Promise.all([myReferralCode().catch(() => ''), fetchFounderReferrals()]);
        setCode(c || d.code);
        setData(d);
      }
      if (isAdmin) setOwed(await fetchReferralOwed().catch(() => []));
    } catch (e) {
      console.warn('affiliate load failed', e);
    } finally {
      setLoading(false);
    }
  }, [isFounder, isAdmin]);

  useEffect(() => { load(); }, [load]);

  async function shareCode() {
    if (!code) return;
    try {
      await Share.share({ message: t('af.shareMsg').replace('{code}', code).replace('{link}', referralLink(code)) });
    } catch { /* cancelled */ }
  }

  function payOut(o: OwedRow) {
    const owedCents = Math.max(0, o.est_total_cents - o.paid_cents);
    if (owedCents <= 0) return;
    Alert.alert(
      t('af.markPaid'),
      t('af.payConfirm').replace('{amount}', dollars(owedCents)).replace('{name}', o.name),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('af.markPaid'),
          onPress: async () => {
            try {
              await recordReferralPayout(o.founder_id, owedCents);
              await load();
            } catch (e: any) {
              Alert.alert(t('af.error'), e.message ?? t('md.tryAgain'));
            }
          },
        },
      ],
    );
  }

  if (loading) return <Loading />;

  if (!isFounder && !isAdmin) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('af.title') }} />
        <EmptyState icon="cash-outline" title={t('af.title')} subtitle={t('af.founderOnly')} />
      </Screen>
    );
  }

  const owedTotal = data ? Math.max(0, data.est_total_cents - data.paid_cents) : 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('af.title') }} />

      {isFounder && (
        <>
          <ThemedText themeColor="textSecondary">{t('af.intro')}</ThemedText>

          {/* Code + share */}
          <Card style={{ gap: Spacing.three, alignItems: 'center' }}>
            <ThemedText type="small" themeColor="textSecondary">{t('af.yourCode')}</ThemedText>
            <ThemedText style={{ fontWeight: '900', fontSize: 32, letterSpacing: 4 }}>{code ?? '—'}</ThemedText>
            <Button label={t('af.share')} icon="share-social" onPress={shareCode} disabled={!code} />
          </Card>

          {/* Earnings */}
          <Card style={{ gap: Spacing.three }}>
            <View style={styles.stats}>
              <Stat label={t('af.statReferred')} value={String(data?.total ?? 0)} />
              <Stat label={t('af.statActive')} value={String(data?.active ?? 0)} />
            </View>
            <View style={styles.stats}>
              <Stat label={t('af.statEarned')} value={dollars(data?.est_total_cents ?? 0)} tint={theme.success} />
              <Stat label={t('af.statOwed')} value={dollars(owedTotal)} tint={theme.accent} />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>{t('af.estNote')}</ThemedText>
          </Card>

          {/* Referred members */}
          <ThemedText style={styles.section}>{t('af.members')}</ThemedText>
          {(data?.members.length ?? 0) === 0 ? (
            <EmptyState icon="people-outline" title={t('af.none')} subtitle={t('af.noneSub')} />
          ) : (
            <Card style={{ paddingVertical: Spacing.one }}>
              {data!.members.map((m, i) => (
                <View key={m.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <View style={styles.row}>
                    <Avatar name={m.display_name} size={36} />
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{m.display_name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        @{m.username} · {m.active ? t('af.active') : t('af.inactive')}
                      </ThemedText>
                    </View>
                    <ThemedText style={{ fontWeight: '800', color: m.active ? theme.success : theme.textSecondary }}>
                      {dollars(m.est_cents)}
                    </ThemedText>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      {/* Owner: payouts owed to founders */}
      {isAdmin && (
        <>
          <ThemedText style={styles.section}>{t('af.ownerTitle')}</ThemedText>
          {owed.length === 0 ? (
            <EmptyState icon="cash-outline" title={t('af.ownerNone')} subtitle={t('af.ownerNoneSub')} />
          ) : (
            <Card style={{ gap: Spacing.two }}>
              {owed.map((o) => {
                const owedCents = Math.max(0, o.est_total_cents - o.paid_cents);
                return (
                  <View key={o.founder_id} style={styles.owedRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{o.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {o.referred} {t('af.referredLc')} · {t('af.paidLc')} {dollars(o.paid_cents)}
                      </ThemedText>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <ThemedText style={{ fontWeight: '800', color: theme.accent }}>{dollars(owedCents)}</ThemedText>
                      {owedCents > 0 && (
                        <Pressable onPress={() => payOut(o)}>
                          <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }}>{t('af.markPaid')}</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Ionicons name="information-circle-outline" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>{t('af.ownerNote')}</ThemedText>
          </View>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <ThemedText style={{ fontWeight: '900', fontSize: 22, color: tint ?? theme.text }}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  stats: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  owedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
