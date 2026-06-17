import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BeltChip, Button, Card, EmptyState, FOUNDER_GOLD, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { fetchMyEliteGrants, grantElite, revokeElite, type EliteGrants, type EliteMember } from '@/lib/elite';
import type { BeltRank } from '@/lib/types';

export default function EliteScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { profile } = useAuth();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<EliteGrants>({ quota: 10, used: 0, members: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setGrants(await fetchMyEliteGrants());
    } catch (e) {
      console.warn('elite grants failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!email.trim()) {
      Alert.alert(t('elite.error'), t('elite.emailReq'));
      return;
    }
    setBusy(true);
    try {
      const res = await grantElite(email.trim());
      if (!res.found) {
        Alert.alert(t('elite.notFoundTitle'), t('elite.notFound'));
      } else if (res.already) {
        Alert.alert(t('elite.alreadyTitle'), t('elite.already').replace('{name}', res.name ?? email.trim()));
      } else {
        Alert.alert('🎖️', t('elite.granted').replace('{name}', res.name ?? email.trim()));
        setEmail('');
        await load();
      }
    } catch (e: any) {
      Alert.alert(t('elite.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRevoke(m: EliteMember) {
    Alert.alert(t('elite.revokeTitle'), t('elite.revokeBody').replace('{name}', m.display_name), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('elite.revoke'),
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeElite(m.id);
            await load();
          } catch (e: any) {
            Alert.alert(t('elite.error'), e.message ?? t('md.tryAgain'));
          }
        },
      },
    ]);
  }

  // Founding members only — defensive (the entry point is gated too, and the DB re-checks).
  if (!profile?.is_founding_member) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('elite.title') }} />
        <EmptyState icon="lock-closed-outline" title={t('elite.title')} subtitle={t('elite.foundersOnly')} />
      </Screen>
    );
  }

  if (loading) return <Loading />;

  const remaining = Math.max(0, grants.quota - grants.used);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('elite.title') }} />

      <Card style={{ gap: Spacing.two, alignItems: 'center' }}>
        <Ionicons name="ribbon" size={28} color={FOUNDER_GOLD} />
        <ThemedText style={{ fontWeight: '800', fontSize: 22 }}>{remaining} / {grants.quota}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>{t('elite.intro')}</ThemedText>
      </Card>

      <Card style={{ gap: Spacing.three }}>
        <ThemedText type="small" themeColor="textSecondary">{t('elite.addHint')}</ThemedText>
        <TextField
          value={email}
          onChangeText={setEmail}
          placeholder={t('elite.emailPh')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <Button label={t('elite.grant')} icon="ribbon" onPress={add} loading={busy} disabled={remaining <= 0} />
      </Card>

      <ThemedText style={{ fontWeight: '800', fontSize: 18, marginTop: Spacing.one }}>
        {t('elite.membersTitle')} · {grants.used}
      </ThemedText>

      {grants.members.length === 0 ? (
        <EmptyState icon="people-outline" title={t('elite.none')} subtitle={t('elite.addHint')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {grants.members.map((m, i) => (
            <View key={m.id}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
              <View style={styles.row}>
                <Ionicons name="ribbon" size={16} color={FOUNDER_GOLD} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{m.display_name}</ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <BeltChip belt={m.belt_rank as BeltRank} size="sm" />
                    <ThemedText type="small" themeColor="textSecondary">@{m.username} · {m.rating}</ThemedText>
                  </View>
                </View>
                <Pressable onPress={() => confirmRevoke(m)} hitSlop={8}>
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
