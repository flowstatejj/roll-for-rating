import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  dollars, fetchAdminFounderReferrals, fetchAdminStatements, fetchAffiliateLeaderboard, fetchFounderReferrals,
  fetchFounderStatements, fetchReferralOwed, generateStatements, markStatementPaid, myReferralCode, referralLink,
  type AdminStatementRow, type FounderReferrals, type FounderStatement, type LeaderboardRow, type OwedRow,
  type ReferredMember,
} from '@/lib/referrals';

export default function AffiliateScreen() {
  const theme = useTheme();
  const { t, lang } = useTranslation();
  const { profile } = useAuth();
  const isFounder = !!profile?.is_founding_member;
  const isAdmin = !!profile?.is_admin;

  const [code, setCode] = useState<string | null>(null);
  const [data, setData] = useState<FounderReferrals | null>(null);
  const [owed, setOwed] = useState<OwedRow[]>([]);
  const [stmts, setStmts] = useState<FounderStatement[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [adminStmts, setAdminStmts] = useState<{ month: string | null; rows: AdminStatementRow[] }>({ month: null, rows: [] });
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [showAllOwed, setShowAllOwed] = useState(false);
  const [showAllStmts, setShowAllStmts] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [founderMembers, setFounderMembers] = useState<Record<string, ReferredMember[]>>({});
  const [expLoading, setExpLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (isFounder) {
        const [c, d, s, b] = await Promise.all([
          myReferralCode().catch(() => ''),
          fetchFounderReferrals(),
          fetchFounderStatements().catch(() => []),
          fetchAffiliateLeaderboard().catch(() => []),
        ]);
        setCode(c || d.code);
        setData(d);
        setStmts(s);
        setBoard(b);
      }
      if (isAdmin) {
        const [o, a] = await Promise.all([
          fetchReferralOwed().catch(() => []),
          fetchAdminStatements().catch(() => ({ month: null, rows: [] })),
        ]);
        setOwed(o);
        setAdminStmts(a);
      }
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

  // "June 2026" in the member's language; s.month arrives as YYYY-MM-DD.
  function monthName(iso: string): string {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    const s = d.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function payStatement(row: AdminStatementRow) {
    Alert.alert(
      t('af.markPaid'),
      t('af.payConfirm').replace('{amount}', dollars(row.share_cents)).replace('{name}', row.name),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('af.markPaid'),
          onPress: async () => {
            try {
              await markStatementPaid(row.id);
              await load();
            } catch (e: any) {
              Alert.alert(t('af.error'), e.message ?? t('md.tryAgain'));
            }
          },
        },
      ],
    );
  }

  async function generateNow() {
    setGenerating(true);
    try {
      await generateStatements();
      await load();
      Alert.alert(t('af.title'), t('af.generated'));
    } catch (e: any) {
      Alert.alert(t('af.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setGenerating(false);
    }
  }

  // Tap an owed row to see exactly who that founder referred (loaded once).
  async function toggleFounder(o: OwedRow) {
    if (expanded === o.founder_id) { setExpanded(null); return; }
    setExpanded(o.founder_id);
    if (founderMembers[o.founder_id]) return;
    setExpLoading(o.founder_id);
    try {
      const m = await fetchAdminFounderReferrals(o.founder_id);
      setFounderMembers((prev) => ({ ...prev, [o.founder_id]: m }));
    } catch (e) {
      console.warn('founder referrals load failed', e);
      setExpanded((cur) => (cur === o.founder_id ? null : cur)); // collapse so a re-tap retries
    } finally {
      setExpLoading((cur) => (cur === o.founder_id ? null : cur));
    }
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

  // Once statements exist they are the ledger: "owed" = pending statement share,
  // not the drifting lifetime estimate. Estimate only until the first statement.
  const pendingStmtCents = stmts.filter((s) => s.status === 'pending').reduce((n, s) => n + s.share_cents, 0);
  const owedTotal = stmts.length > 0
    ? pendingStmtCents
    : (data ? Math.max(0, data.est_total_cents - data.paid_cents) : 0);

  // Newest referrals first, capped at 10 - both lists grow unbounded otherwise.
  const members = [...(data?.members ?? [])].sort((a, b) => new Date(b.joined).getTime() - new Date(a.joined).getTime());
  const visibleMembers = showAllMembers ? members : members.slice(0, 10);
  const owedCentsFor = (o: OwedRow) => Math.max(0, o.est_total_cents - o.paid_cents);
  const owedSorted = [...owed].sort((a, b) => owedCentsFor(b) - owedCentsFor(a));
  const visibleOwed = showAllOwed ? owedSorted : owedSorted.slice(0, 10);

  // Owner launch pulse (admin section summary).
  const totalReferred = owed.reduce((n, o) => n + o.referred, 0);
  const owedPendingStmts = adminStmts.rows.filter((r) => r.status === 'pending').reduce((n, r) => n + r.share_cents, 0);
  const lifetimePaid = owed.reduce((n, o) => n + o.paid_cents, 0);
  const signupsWeek = owed.reduce((n, o) => n + (o.signups_7d ?? 0), 0);
  const latestMonth = adminStmts.month?.slice(0, 10) ?? null;

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

          {/* Monthly statements (frozen ledger) */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('af.statements')}</ThemedText>
          {stmts.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">{t('af.stNone')}</ThemedText>
          ) : (
            <>
              <Card style={{ paddingVertical: Spacing.one }}>
                {(showAllStmts ? stmts : stmts.slice(0, 6)).map((s, i) => (
                  <View key={s.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{monthName(s.month)}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {t('af.stLine')
                            .replace('{a}', String(s.apple_active))
                            .replace('{g}', String(s.google_active))
                            .replace('{s}', String(s.signups))}
                        </ThemedText>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <ThemedText style={{ fontWeight: '800', color: s.status === 'paid' ? theme.success : theme.accent }}>
                          {dollars(s.share_cents)}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {s.status === 'paid' ? t('af.paid') : t('af.pending')}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
              {stmts.length > 6 && !showAllStmts && (
                <Pressable onPress={() => setShowAllStmts(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
                </Pressable>
              )}
            </>
          )}

          {/* Founder leaderboard */}
          {board.length > 0 && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('af.leaderboard')}</ThemedText>
              <Card style={{ paddingVertical: Spacing.one }}>
                {board.slice(0, 10).map((b, i) => {
                  const me = b.founder_id === profile?.id;
                  return (
                    <View key={b.founder_id}>
                      {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                      <View style={styles.row}>
                        <ThemedText style={{ fontWeight: '900', width: 26, color: me ? theme.accent : theme.textSecondary }}>
                          {i + 1}
                        </ThemedText>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={{ fontWeight: '700', color: me ? theme.accent : theme.text }} numberOfLines={1}>
                            {b.name}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                            {t('af.lbLine').replace('{a}', String(b.active)).replace('{r}', String(b.referred))}
                          </ThemedText>
                        </View>
                        <ThemedText type="small" style={{ fontWeight: '800', color: theme.success }}>
                          {dollars(b.lifetime_cents)}
                        </ThemedText>
                      </View>
                    </View>
                  );
                })}
              </Card>
            </>
          )}

          {/* Referred members */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('af.members')}</ThemedText>
          {members.length === 0 ? (
            <EmptyState icon="people-outline" title={t('af.none')} subtitle={t('af.noneSub')} />
          ) : (
            <>
              <Card style={{ paddingVertical: Spacing.one }}>
                {visibleMembers.map((m, i) => (
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
              {members.length > 10 && !showAllMembers && (
                <Pressable onPress={() => setShowAllMembers(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
                </Pressable>
              )}
            </>
          )}
        </>
      )}

      {/* Owner: launch pulse + monthly statements to pay */}
      {isAdmin && (
        <>
          <Card style={{ gap: Spacing.three, marginTop: Spacing.one }}>
            <View style={styles.stats}>
              <Stat label={t('af.statReferred')} value={String(totalReferred)} />
              <Stat label={t('af.newWeek')} value={String(signupsWeek)} />
            </View>
            <View style={styles.stats}>
              <Stat label={t('af.owedMonth')} value={dollars(owedPendingStmts)} tint={theme.accent} />
              <Stat label={t('af.lifetimePaid')} value={dollars(lifetimePaid)} tint={theme.success} />
            </View>
          </Card>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            {t('af.statements')}{adminStmts.month ? ` · ${monthName(adminStmts.month)}` : ''}
          </ThemedText>
          {adminStmts.rows.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">{t('af.stNone')}</ThemedText>
          ) : (
            <Card style={{ paddingVertical: Spacing.one }}>
              {adminStmts.rows.map((s, i) => (
                <View key={s.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{s.name}</ThemedText>
                      {!!s.month && !!latestMonth && s.month.slice(0, 10) !== latestMonth && (
                        <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }} numberOfLines={1}>
                          {t('af.overdueMonth').replace('{month}', monthName(s.month))}
                        </ThemedText>
                      )}
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {t('af.stLine')
                          .replace('{a}', String(s.apple_active))
                          .replace('{g}', String(s.google_active))
                          .replace('{s}', String(s.signups))}
                        {` · ${t('af.netLc')} ${dollars(s.net_cents ?? 0)}`}
                      </ThemedText>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <ThemedText style={{ fontWeight: '800', color: s.status === 'paid' ? theme.success : theme.accent }}>
                        {dollars(s.share_cents)}
                      </ThemedText>
                      {s.status === 'paid' ? (
                        <ThemedText type="small" themeColor="textSecondary">{t('af.paid')}</ThemedText>
                      ) : (
                        <Pressable onPress={() => payStatement(s)} hitSlop={8}>
                          <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }}>{t('af.markPaid')}</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          )}
          <Button label={t('af.generate')} icon="refresh" variant="secondary" onPress={generateNow} loading={generating} />

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('af.lifetimeRef')}</ThemedText>
          {owed.length === 0 ? (
            <EmptyState icon="cash-outline" title={t('af.ownerNone')} subtitle={t('af.ownerNoneSub')} />
          ) : (
            <>
              <Card style={{ gap: Spacing.two }}>
                {visibleOwed.map((o) => {
                  const owedCents = owedCentsFor(o);
                  const isOpen = expanded === o.founder_id;
                  return (
                    <View key={o.founder_id}>
                      <Pressable onPress={() => toggleFounder(o)} style={styles.owedRow}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{o.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {o.referred} {t('af.referredLc')} · {t('af.paidLc')} {dollars(o.paid_cents)}
                          </ThemedText>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <ThemedText style={{ fontWeight: '800', color: theme.accent }}>{dollars(owedCents)}</ThemedText>
                          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textSecondary} />
                        </View>
                      </Pressable>
                      {isOpen && (expLoading === o.founder_id ? (
                        <ActivityIndicator size="small" color={theme.textSecondary} style={{ paddingVertical: Spacing.two }} />
                      ) : (
                        (founderMembers[o.founder_id] ?? []).map((m) => (
                          <View key={m.id} style={styles.memberRow}>
                            <Avatar name={m.display_name} size={28} />
                            <View style={{ flex: 1 }}>
                              <ThemedText type="small" style={{ fontWeight: '700' }} numberOfLines={1}>{m.display_name}</ThemedText>
                              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                                @{m.username} · {m.active ? t('af.active') : t('af.inactive')}
                              </ThemedText>
                            </View>
                            <ThemedText type="small" style={{ fontWeight: '800', color: m.active ? theme.success : theme.textSecondary }}>
                              {dollars(m.est_cents)}
                            </ThemedText>
                          </View>
                        ))
                      ))}
                    </View>
                  );
                })}
              </Card>
              {owed.length > 10 && !showAllOwed && (
                <Pressable onPress={() => setShowAllOwed(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
                </Pressable>
              )}
            </>
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
  section: { marginTop: Spacing.one },
  stats: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  owedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one, paddingLeft: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
  older: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
});
