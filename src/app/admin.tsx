import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BeltChip, Button, Card, EmptyState, FOUNDER_GOLD, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listFounders, makeFoundingByEmail, setFoundingById, type Founder } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchDisputes, resolveDispute, type DisputeReport, type MatchDispute } from '@/lib/matches';
import { fetchUserReports, resolveUserReport, type UserReport } from '@/lib/safety';
import type { BeltRank } from '@/lib/types';

export default function AdminScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [founders, setFounders] = useState<Founder[]>([]);
  const [disputes, setDisputes] = useState<MatchDispute[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reports, setReports] = useState<UserReport[]>([]);
  const [actingReportId, setActingReportId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFounders(await listFounders());
    } catch (e) {
      console.warn('Failed to load founders', e);
    }
    try {
      setDisputes(await fetchDisputes());
    } catch (e) {
      console.warn('Failed to load disputes', e);
    }
    try {
      setReports(await fetchUserReports());
    } catch (e) {
      console.warn('Failed to load reports', e);
    }
  }, []);

  function actOnReport(rep: UserReport, action: 'dismiss' | 'remove' | 'ban') {
    const label = action === 'dismiss' ? t('admin.repDismiss') : action === 'remove' ? t('admin.repRemove') : t('admin.repBan');
    const body = action === 'ban' ? t('admin.repBanConfirm') : action === 'remove' ? t('admin.repRemoveConfirm') : t('admin.repDismissConfirm');
    Alert.alert(label, body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: label,
        style: action === 'dismiss' ? 'default' : 'destructive',
        onPress: async () => {
          setActingReportId(rep.id);
          try {
            await resolveUserReport(rep.id, action);
            await load();
          } catch (e: any) {
            Alert.alert(t('admin.error'), e.message ?? t('md.tryAgain'));
          } finally {
            setActingReportId(null);
          }
        },
      },
    ]);
  }

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(d: MatchDispute, r: DisputeReport) {
    setResolvingId(d.match_id);
    try {
      await resolveDispute({
        matchId: d.match_id,
        winnerId: r.winner_id,
        result: r.result,
        submissionType: r.submission_type,
        method: r.method,
      });
      await load();
    } catch (e: any) {
      Alert.alert(t('admin.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setResolvingId(null);
    }
  }

  function nameFor(d: MatchDispute, id: string | null): string {
    if (id === null) return t('md.draw');
    return id === d.challenger.id ? d.challenger.name : d.opponent.name;
  }

  async function add() {
    if (!email.trim()) {
      Alert.alert(t('admin.error'), t('admin.emailReq'));
      return;
    }
    setBusy(true);
    try {
      const res = await makeFoundingByEmail(email.trim(), true);
      if (!res.found) {
        Alert.alert(t('admin.notFoundTitle'), t('admin.notFound'));
      } else {
        Alert.alert('🎉', t('admin.added').replace('{name}', res.display_name ?? email.trim()));
        setEmail('');
        await load();
      }
    } catch (e: any) {
      Alert.alert(t('admin.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(f: Founder) {
    Alert.alert(t('admin.removeConfirmTitle'), t('admin.removeConfirm').replace('{name}', f.display_name), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.removeFounder'),
        style: 'destructive',
        onPress: async () => {
          try {
            await setFoundingById(f.id, false);
            await load();
          } catch (e: any) {
            Alert.alert(t('admin.error'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  // Admins only — defensive (the button is already gated, and the DB re-checks).
  if (!profile?.is_admin) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('admin.title') }} />
        <EmptyState icon="lock-closed-outline" title={t('admin.title')} subtitle={t('admin.adminsOnly')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('admin.title') }} />

      {/* Disputed match results awaiting an official call */}
      {disputes.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one }}>
            <Ionicons name="alert-circle" size={20} color={theme.danger} />
            <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{t('admin.disputesTitle')} · {disputes.length}</ThemedText>
          </View>
          {disputes.map((d) => (
            <Card key={d.match_id} style={{ gap: Spacing.two, borderColor: theme.danger, borderWidth: 1 }}>
              <ThemedText style={{ fontWeight: '800' }}>{d.challenger.name} {t('md.vs')} {d.opponent.name}</ThemedText>
              {(d.reports ?? []).map((r) => {
                const reporter = r.reporter_id === d.challenger.id ? d.challenger.name : d.opponent.name;
                return (
                  <ThemedText key={r.reporter_id} type="small" themeColor="textSecondary">
                    {t('admin.reportedBy').replace('{reporter}', reporter).replace('{winner}', nameFor(d, r.winner_id))}
                    {r.submission_type ? ` · ${r.submission_type}` : ''}
                  </ThemedText>
                );
              })}
              <Button label={t('admin.viewVideo')} variant="secondary" icon="play-circle" onPress={() => router.push(`/match/${d.match_id}`)} />
              <ThemedText type="smallBold" themeColor="textSecondary">{t('admin.setOfficial')}</ThemedText>
              {(d.reports ?? []).map((r) => (
                <Button
                  key={`res-${r.reporter_id}`}
                  label={`${nameFor(d, r.winner_id)}${r.submission_type ? ` (${r.submission_type})` : ''}`}
                  loading={resolvingId === d.match_id}
                  onPress={() => resolve(d, r)}
                />
              ))}
            </Card>
          ))}
        </>
      )}

      {/* User reports — moderation queue (App Store 1.2: act within 24h) */}
      {reports.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one }}>
            <Ionicons name="flag" size={20} color={theme.danger} />
            <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{t('admin.reportsTitle')} · {reports.length}</ThemedText>
          </View>
          {reports.map((rep) => (
            <Card key={rep.id} style={{ gap: Spacing.two, borderColor: theme.danger, borderWidth: 1 }}>
              <ThemedText style={{ fontWeight: '800' }}>{rep.reported_name ?? t('admin.repUnknown')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('admin.repReason').replace('{reason}', rep.reason).replace('{reporter}', rep.reporter_name ?? '—')}
              </ThemedText>
              {rep.details ? (
                <ThemedText type="small" themeColor="textSecondary">{rep.details}</ThemedText>
              ) : null}
              {rep.match_id ? (
                <Button label={t('admin.viewVideo')} variant="secondary" icon="play-circle" onPress={() => router.push(`/match/${rep.match_id}`)} />
              ) : null}
              <Button label={t('admin.repDismiss')} variant="secondary" onPress={() => actOnReport(rep, 'dismiss')} loading={actingReportId === rep.id} />
              {rep.match_id ? (
                <Button label={t('admin.repRemove')} onPress={() => actOnReport(rep, 'remove')} loading={actingReportId === rep.id} />
              ) : null}
              <Button label={t('admin.repBan')} onPress={() => actOnReport(rep, 'ban')} loading={actingReportId === rep.id} />
            </Card>
          ))}
        </>
      )}

      <Card style={{ gap: Spacing.three }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Ionicons name="star" size={18} color={FOUNDER_GOLD} />
          <ThemedText style={{ fontWeight: '800', fontSize: 16 }}>{t('admin.addByEmail')}</ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('admin.addHint')}
        </ThemedText>
        <TextField
          value={email}
          onChangeText={setEmail}
          placeholder={t('admin.emailPh')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <Button label={t('admin.makeFounder')} icon="star" onPress={add} loading={busy} />
      </Card>

      <ThemedText style={{ fontWeight: '800', fontSize: 18, marginTop: Spacing.one }}>
        {t('admin.foundersTitle')} · {founders.length}
      </ThemedText>

      {founders.length === 0 ? (
        <EmptyState icon="people-outline" title={t('admin.none')} subtitle={t('admin.addHint')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {founders.map((f, i) => (
            <View key={f.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <View style={styles.row}>
                <Ionicons name="star" size={16} color={FOUNDER_GOLD} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                    {f.display_name}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <BeltChip belt={f.belt_rank as BeltRank} size="sm" />
                    <ThemedText type="small" themeColor="textSecondary">
                      @{f.username} · {f.rating}
                    </ThemedText>
                  </View>
                </View>
                <Pressable onPress={() => confirmRemove(f)} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
