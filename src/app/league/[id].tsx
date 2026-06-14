import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchMyFriends, type FriendProfile } from '@/lib/friends';
import { useTranslation } from '@/lib/i18n';
import {
  currentLeagueWeek,
  fetchFixtures,
  fetchLeague,
  fetchMembers,
  fetchStandings,
  generateWeek,
  hasLeagueInvite,
  inviteToLeague,
  joinLeague,
  leaveLeague,
  respondLeagueInvite,
} from '@/lib/leagues';
import { searchProfiles } from '@/lib/matches';
import type { League, LeagueFixture, LeagueMember, LeagueStanding, Profile } from '@/lib/types';

export default function LeagueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [fixtures, setFixtures] = useState<LeagueFixture[]>([]);
  const [standings, setStandings] = useState<LeagueStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState(false);

  // Organizer invite picker
  const [picking, setPicking] = useState(false);
  const [pq, setPq] = useState('');
  const [presults, setPresults] = useState<Profile[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);

  const load = useCallback(async () => {
    try {
      const l = await fetchLeague(id);
      setLeague(l);
      if (l) {
        const week = currentLeagueWeek(l);
        const [m, f, s] = await Promise.all([fetchMembers(id), fetchFixtures(id, week), fetchStandings(id)]);
        setMembers(m);
        setFixtures(f);
        setStandings(s);
      }
      hasLeagueInvite(id).then(setInvited).catch(() => {});
    } catch (e) {
      console.warn('league load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // While the picker is open: empty query shows friends, typing searches everyone.
  useEffect(() => {
    if (!picking) return;
    if (friends.length === 0) fetchMyFriends().then(setFriends).catch(() => {});
    const h = setTimeout(async () => {
      try { setPresults(pq.trim() ? await searchProfiles(pq, []) : []); } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(h);
  }, [pq, picking, friends.length]);

  if (loading) return <Loading />;
  if (!league) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="people-circle-outline" title={t('le.notFound')} subtitle="" />
      </Screen>
    );
  }

  const week = currentLeagueWeek(league);
  const me = members.find((m) => m.user_id === userId);
  const isMember = !!me;
  const isOrganizer = league.created_by === userId;
  const myFixture = fixtures.find((f) => f.player_a === userId || f.player_b === userId);

  async function act(fn: () => Promise<unknown>) {
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

  async function shareCode() {
    try {
      await Share.share({ message: t('le.shareMsg').replace('{name}', league!.name).replace('{code}', league!.join_code) });
    } catch {
      Alert.alert(t('le.code'), league!.join_code);
    }
  }

  // Invite a person; keep the picker open so the organizer can invite several.
  async function invitePerson(uid: string) {
    setPq('');
    await act(() => inviteToLeague(id, uid));
  }

  function startFixture(f: LeagueFixture) {
    const opponent = f.player_a === userId ? f.player_b : f.player_a;
    if (!opponent) return;
    router.push(`/match/new?opponent=${opponent}&league=${league!.id}&week=${week}`);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: league.name }} />

      {/* Header */}
      <Card style={{ gap: Spacing.two }}>
        <ThemedText style={{ fontWeight: '800', fontSize: 22 }}>{league.name}</ThemedText>
        {league.description ? <ThemedText themeColor="textSecondary">{league.description}</ThemedText> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one }}>
          <Tag text={league.ranked ? t('le.rankedChip') : t('le.casualChip')} tint={league.ranked ? theme.accent : theme.textSecondary} />
          {league.audience !== 'all' && <Tag text={t(`le.aud.${league.audience}`)} tint={theme.textSecondary} />}
          <Tag text={league.visibility === 'private' ? t('le.vis.private') : t('le.vis.open')} tint={theme.textSecondary} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Ionicons name="calendar" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('le.meets')} {t(`wd.${league.meet_day}`)}{league.meet_time ? ` · ${league.meet_time}` : ''}
            {league.location ? ` · ${league.location}` : ''}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('le.week')} {week} {t('le.of')} {league.weeks}
        </ThemedText>
      </Card>

      {/* Invitation to accept (you've been invited by the organizer) */}
      {invited && !isMember && (
        <Card style={{ gap: Spacing.two, borderColor: theme.accent, borderWidth: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Ionicons name="mail-open" size={20} color={theme.accent} />
            <ThemedText style={{ fontWeight: '800', flex: 1 }}>{t('le.invitedTitle')}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{t('le.invitedBody')}</ThemedText>
          <Button label={t('le.acceptInvite')} icon="checkmark-circle" loading={busy} onPress={() => act(() => respondLeagueInvite(id, true))} />
          <Button label={t('le.declineInvite')} variant="ghost" loading={busy} onPress={() => act(() => respondLeagueInvite(id, false))} />
        </Card>
      )}

      {/* Membership actions */}
      {!isMember ? (
        !invited && (
          <>
            <Button label={t('le.joinLeague')} icon="add-circle" loading={busy} onPress={() => act(() => joinLeague(userId, league.id))} />
            <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>{t('le.notMember')}</ThemedText>
          </>
        )
      ) : (
        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          <View style={{ flex: 1 }}>
            <Button label={t('le.shareCode')} icon="share-outline" variant="secondary" onPress={shareCode} />
          </View>
          {!isOrganizer && (
            <View style={{ flex: 1 }}>
              <Button label={t('le.leave')} icon="exit-outline" variant="ghost" loading={busy} onPress={() => act(() => leaveLeague(userId, league.id))} />
            </View>
          )}
        </View>
      )}

      {/* Organizer: invite specific people (friends first) */}
      {isOrganizer && (
        <Button label={t('le.invitePlayers')} icon="person-add" variant="secondary" onPress={() => { setPicking(true); setPq(''); setPresults([]); }} />
      )}
      {picking && (
        <Card style={{ gap: Spacing.two, borderColor: theme.accent, borderWidth: 1 }}>
          <ThemedText style={{ fontWeight: '800' }}>{t('le.pickInvite')}</ThemedText>
          <TextField value={pq} onChangeText={setPq} placeholder={t('frn.searchPh')} autoCapitalize="none" />
          {(() => {
            const memberIds = new Set(members.map((m) => m.user_id));
            const rows: { id: string; display_name: string; belt_rank: string; warrior?: string | null; color?: string | null }[] =
              pq.trim()
                ? presults.filter((p) => !memberIds.has(p.id)).map((p) => ({ id: p.id, display_name: p.display_name, belt_rank: p.belt_rank, warrior: p.avatar_warrior, color: p.avatar_color }))
                : friends.filter((f) => !memberIds.has(f.id)).map((f) => ({ id: f.id, display_name: f.display_name, belt_rank: f.belt_rank, warrior: f.avatar_warrior, color: f.avatar_color }));
            return (
              <>
                {!pq.trim() && (
                  <ThemedText type="small" themeColor="textSecondary">{rows.length ? t('frn.inviteFriendsHint') : t('frn.noFriendsHint')}</ThemedText>
                )}
                {rows.slice(0, 10).map((p) => (
                  <Pressable key={p.id} onPress={() => invitePerson(p.id)}>
                    <View style={styles.prow}>
                      <Avatar name={p.display_name} size={32} warrior={p.warrior ?? undefined} color={p.color ?? undefined} />
                      <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{p.display_name}</ThemedText>
                      <BeltChip belt={p.belt_rank as any} size="sm" />
                    </View>
                  </Pressable>
                ))}
              </>
            );
          })()}
          <Button label={t('common.cancel')} variant="ghost" onPress={() => { setPicking(false); setPq(''); }} />
        </Card>
      )}

      {/* This week */}
      <ThemedText style={styles.section}>{t('le.thisWeek')}</ThemedText>
      {isOrganizer && fixtures.length === 0 && (
        <Button label={t('le.generate')} icon="shuffle" variant="secondary" loading={busy} onPress={() => act(() => generateWeek(league.id, week))} />
      )}
      {fixtures.length === 0 ? (
        <EmptyState icon="shuffle-outline" title={t('le.noFixturesTitle')} subtitle={isOrganizer ? t('le.noFixturesOrg') : t('le.noFixturesSub')} />
      ) : (
        <>
          {isMember && (
            <Card style={{ gap: Spacing.two, borderColor: theme.accent, borderWidth: 1 }}>
              <ThemedText style={{ fontWeight: '800' }}>{t('le.yourMatch')}</ThemedText>
              {!myFixture ? (
                <ThemedText themeColor="textSecondary">{t('le.notPaired')}</ThemedText>
              ) : !myFixture.player_b ? (
                <ThemedText themeColor="textSecondary">{t('le.bye')}</ThemedText>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
                  <Avatar name={(myFixture.player_a === userId ? myFixture.b : myFixture.a)?.display_name ?? '?'} size={40} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: '700' }}>
                      {t('le.vs')} {(myFixture.player_a === userId ? myFixture.b : myFixture.a)?.display_name ?? '?'}
                    </ThemedText>
                  </View>
                  {myFixture.match_id ? (
                    <Button label={t('le.viewMatch')} variant="secondary" onPress={() => router.push(`/match/${myFixture.match_id}`)} />
                  ) : (
                    <Button label={t('le.startMatch')} icon="flame" onPress={() => startFixture(myFixture)} />
                  )}
                </View>
              )}
            </Card>
          )}

          <Card style={{ paddingVertical: Spacing.one }}>
            {fixtures.map((f, i) => (
              <View key={f.id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <View style={styles.fixtureRow}>
                  <ThemedText style={{ flex: 1 }} numberOfLines={1}>
                    {f.a?.display_name ?? '?'} {f.player_b ? `${t('le.vs')} ${f.b?.display_name ?? '?'}` : `· ${t('le.byeShort')}`}
                  </ThemedText>
                  {f.match_id && <Ionicons name="checkmark-circle" size={18} color={theme.success} />}
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* Standings */}
      <ThemedText style={styles.section}>{t('le.standings')}</ThemedText>
      {standings.length === 0 ? (
        <EmptyState icon="podium-outline" title={t('le.noStandingsTitle')} subtitle={t('le.noStandingsSub')} />
      ) : (
        <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
          {standings.map((s, i) => {
            const isMe = s.user_id === userId;
            const medal = i === 0 ? '#E5B53A' : i === 1 ? '#A7AAB0' : i === 2 ? '#B07A45' : null;
            return (
              <View key={s.user_id}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                <Pressable
                  onPress={() => router.push(`/user/${s.user_id}`)}
                  style={[styles.row, isMe && { backgroundColor: theme.accent + '22', borderRadius: 8 }]}>
                  <View style={[styles.rank, { backgroundColor: medal ?? 'transparent' }]}>
                    <ThemedText style={{ fontWeight: '800', color: medal ? '#1a1a1a' : theme.textSecondary }}>{i + 1}</ThemedText>
                  </View>
                  <Avatar name={s.profile?.display_name ?? '?'} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                      {s.profile?.display_name ?? t('le.member')}{isMe ? ` ${t('md.you')}` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {s.wins}{t('lb.w')} · {s.losses}{t('lb.l')} · {s.draws}{t('lb.d')} · {s.played} {t('le.played')}
                    </ThemedText>
                  </View>
                  <ThemedText style={{ fontWeight: '800', fontSize: 18 }}>{s.points}</ThemedText>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      {/* Members */}
      <ThemedText style={styles.section}>{t('le.members')} · {members.length}</ThemedText>
      <Card style={{ paddingVertical: Spacing.one }}>
        {members.map((m, i) => (
          <View key={m.user_id}>
            {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
            <Pressable onPress={() => router.push(`/user/${m.user_id}`)} style={styles.row}>
              <Avatar name={m.profile?.display_name ?? '?'} size={36} />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                  {m.profile?.display_name ?? t('le.member')}
                </ThemedText>
                {m.profile && <BeltChip belt={m.profile.belt_rank} size="sm" />}
              </View>
              {m.role === 'organizer' && <Tag text={t('le.organizer')} tint={theme.accent} />}
            </Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function Tag({ text, tint }: { text: string; tint: string }) {
  return (
    <View style={[styles.tag, { borderColor: tint }]}>
      <ThemedText type="small" style={{ color: tint, fontWeight: '700' }}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  fixtureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  prow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
});
