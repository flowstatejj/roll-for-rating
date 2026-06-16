import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DropField, OptionRow, dropdownStyles } from '@/components/dropdowns';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { scopeMatches, type Geo, type Scope, SCOPE_KEYS } from '@/lib/geo';
import { useTranslation } from '@/lib/i18n';
import { fetchMyGeo, fetchWagerLeaderboard, type WagerLeader } from '@/lib/matches';

export default function HighRollersScreen() {
  const { session, profile } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session?.user.id;

  const [rows, setRows] = useState<WagerLeader[]>([]);
  const [myGeo, setMyGeo] = useState<Geo | null>(null);
  const [scope, setScope] = useState<Scope>('city'); // default to the member's own city
  const [openMenu, setOpenMenu] = useState(false);
  const scopeTouched = useRef(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [leaders, geo] = await Promise.all([
        fetchWagerLeaderboard(),
        userId ? fetchMyGeo(userId).catch(() => null) : Promise.resolve(null),
      ]);
      setRows(leaders);
      setMyGeo(geo);
    } catch (e) {
      console.warn('wager leaderboard failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Fall back off the "city" default to World only when the member has no city.
  useEffect(() => {
    if (scopeTouched.current || scope !== 'city') return;
    if (myGeo && !myGeo.city) setScope('world');
  }, [myGeo, scope]);

  const scopeLabel = (s: Scope) => t(s === 'gym' ? 'geo.gym' : `geo.${s}`);
  const pickScope = (s: Scope) => { scopeTouched.current = true; setScope(s); setOpenMenu(false); };

  const filtered = useMemo(
    () => rows.filter((r) => scopeMatches(myGeo, profile?.gym_id ?? null, r.geo, r.gym_id, scope)),
    [rows, myGeo, profile?.gym_id, scope],
  );

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.biggestPots') }} />
      <ThemedText themeColor="textSecondary">{t('hr.intro')}</ThemedText>

      {/* Location scope (same options as Rankings) */}
      <View style={{ gap: Spacing.two }}>
        <View style={dropdownStyles.controls}>
          <DropField icon="earth-outline" text={scopeLabel(scope)} open={openMenu} onPress={() => setOpenMenu((o) => !o)} />
        </View>
        {openMenu && (
          <Card style={dropdownStyles.menu}>
            {SCOPE_KEYS.map((s) => (
              <OptionRow key={s} label={scopeLabel(s)} selected={scope === s} onPress={() => pickScope(s)} />
            ))}
          </Card>
        )}
        {scope === 'gym' && !profile?.gym_id && (
          <ThemedText type="small" themeColor="textSecondary">{t('lb.noGym')}</ThemedText>
        )}
        {scope !== 'gym' && scope !== 'world' && !myGeo?.[scope] && (
          <ThemedText type="small" themeColor="textSecondary">{t('lb.noGeo')}</ThemedText>
        )}
      </View>

      {filtered.length === 0 ? (
        <EmptyState icon="cash-outline" title={t('hr.emptyTitle')} subtitle={t('hr.emptySub')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {filtered.map((r, i) => {
            const isMe = r.user_id === userId;
            const rank = i + 1;
            const medal = rank === 1 ? '#E5B53A' : rank === 2 ? '#A7AAB0' : rank === 3 ? '#B07A45' : null;
            return (
              <View key={r.user_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                  <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                    <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>
                      {rank}
                    </ThemedText>
                  </View>
                  <Pressable onPress={() => router.push(`/user/${r.user_id}`)} style={styles.tap}>
                    <Avatar name={r.display_name} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                        {r.display_name}
                        {isMe ? ` ${t('lb.you')}` : ''}
                      </ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                        <BeltChip belt={r.belt_rank} size="sm" />
                        <ThemedText type="small" themeColor="textSecondary">
                          {r.wagered_wins} {r.wagered_wins === 1 ? t('hr.potWon') : t('hr.potsWon')}
                        </ThemedText>
                      </View>
                    </View>
                  </Pressable>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="cash" size={16} color={theme.success} />
                    <ThemedText style={{ fontWeight: '800', fontSize: 18, color: theme.success }}>
                      {r.pot_won}
                    </ThemedText>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  tap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
