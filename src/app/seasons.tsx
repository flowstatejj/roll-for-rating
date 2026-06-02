import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Card, EmptyState, Loading, Screen } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { currentSeason, fetchSeasons, fetchSeasonStandings } from '@/lib/seasons';
import type { Season, SeasonStanding } from '@/lib/types';

export default function SeasonsScreen() {
  const { session } = useAuth();
  const theme = useTheme();
  const { t } = useTranslation();
  const userId = session?.user.id;
  const [season, setSeason] = useState<Season | null>(null);
  const [standings, setStandings] = useState<SeasonStanding[]>([]);
  const [past, setPast] = useState<{ season: Season; champ: SeasonStanding | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const seasons = await fetchSeasons();
      const cur = currentSeason(seasons);
      setSeason(cur);
      if (cur) setStandings(await fetchSeasonStandings(cur.id));
      const ended = seasons.filter((s) => new Date(s.ends_at).getTime() < Date.now());
      const champs = await Promise.all(
        ended.map(async (s) => ({ season: s, champ: (await fetchSeasonStandings(s.id, 1))[0] ?? null })),
      );
      setPast(champs);
    } catch (e) {
      console.warn('seasons failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loading />;

  const myRank = standings.findIndex((s) => s.user_id === userId);
  const daysLeft = season ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86400000)) : 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.seasons') }} />

      {season ? (
        <>
          <Card style={{ backgroundColor: theme.accent, gap: Spacing.one }}>
            <ThemedText style={{ color: theme.accentText, fontWeight: '800', fontSize: 22 }}>{season.name}</ThemedText>
            <ThemedText style={{ color: theme.accentText, opacity: 0.9 }}>
              {daysLeft} {daysLeft === 1 ? t('q.day') : t('q.days')} {t('se.left')} · {t('se.perWin')}
            </ThemedText>
            {myRank >= 0 && (
              <ThemedText style={{ color: theme.accentText, fontWeight: '700', marginTop: Spacing.one }}>
                {t('se.you')}: #{myRank + 1} · {standings[myRank].points} {t('se.pts')}
              </ThemedText>
            )}
          </Card>

          <ThemedText style={styles.section}>{t('se.standings')}</ThemedText>
          {standings.length === 0 ? (
            <EmptyState icon="ribbon-outline" title={t('se.noPointsTitle')} subtitle={t('se.noPointsSub')} />
          ) : (
            <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
              {standings.map((s, i) => {
                const isMe = s.user_id === userId;
                const medal = i === 0 ? '#E5B53A' : i === 1 ? '#A7AAB0' : i === 2 ? '#B07A45' : null;
                return (
                  <View key={s.user_id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                    <View style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                      <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                        <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>{i + 1}</ThemedText>
                      </View>
                      <Avatar name={s.profile?.display_name ?? '?'} size={36} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                          {s.profile?.display_name ?? t('se.member')}
                          {isMe ? ` ${t('md.you')}` : ''}
                        </ThemedText>
                        {s.profile && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                            <BeltChip belt={s.profile.belt_rank} size="sm" />
                            <ThemedText type="small" themeColor="textSecondary">{s.wins} {t('gr.wins')}</ThemedText>
                          </View>
                        )}
                      </View>
                      <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{s.points}</ThemedText>
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
        </>
      ) : (
        <EmptyState icon="calendar-outline" title={t('se.noSeasonTitle')} subtitle={t('se.noSeasonSub')} />
      )}

      {past.length > 0 && (
        <>
          <ThemedText style={styles.section}>{t('se.past')}</ThemedText>
          {past.map(({ season: s, champ }) => (
            <Card key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
              <ThemedText style={{ fontSize: 22 }}>👑</ThemedText>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: '800' }}>{s.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {champ ? `${t('se.champion')}: ${champ.profile?.display_name ?? t('se.member')} · ${champ.points} ${t('se.pts')}` : t('se.noChampion')}
                </ThemedText>
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
