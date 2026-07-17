import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { LeagueDivisionRegister } from '@/components/league-division-register';
import { LeagueDivisions } from '@/components/league-divisions';
import { LeagueTeams } from '@/components/league-teams';
import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import {
  currentLeagueWeek,
  fetchFixtures,
  fetchLeague,
  fetchLeagueDivisions,
  fetchLeagueMessages,
  fetchMembers,
  fetchStandings,
  generateWeek,
  hasLeagueInvite,
  joinLeague,
  leaveLeague,
  postLeagueMessage,
  respondLeagueInvite,
} from '@/lib/leagues';
import type { League, LeagueDivision, LeagueFixture, LeagueMember, LeagueMessage, LeagueStanding } from '@/lib/types';

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
  const [messages, setMessages] = useState<LeagueMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [postingMsg, setPostingMsg] = useState(false);
  const [showOlderMsgs, setShowOlderMsgs] = useState(false);
  const [divisions, setDivisions] = useState<LeagueDivision[]>([]);

  const load = useCallback(async () => {
    try {
      const l = await fetchLeague(id);
      setLeague(l);
      if (l) {
        const week = currentLeagueWeek(l);
        const [m, f, s, msgs, dvs] = await Promise.all([
          fetchMembers(id),
          fetchFixtures(id, week),
          fetchStandings(id),
          fetchLeagueMessages(id).catch(() => []),
          fetchLeagueDivisions(id).catch(() => []),
        ]);
        setMembers(m);
        setFixtures(f);
        setStandings(s);
        setMessages(msgs);
        setDivisions(dvs);
      }
      hasLeagueInvite(id).then(setInvited).catch(() => {});
    } catch (e) {
      console.warn('league load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
  const isTeamLeague = league.team_rule !== 'none';
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

  function startFixture(f: LeagueFixture) {
    const opponent = f.player_a === userId ? f.player_b : f.player_a;
    if (!opponent) return;
    router.push(`/match/new?opponent=${opponent}&league=${league!.id}&week=${week}`);
  }

  async function postAnnouncement() {
    if (!msgText.trim()) return;
    setPostingMsg(true);
    try {
      await postLeagueMessage(id, msgText.trim());
      setMsgText('');
      setMessages(await fetchLeagueMessages(id));
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setPostingMsg(false);
    }
  }

  // Generate, then say so if nothing came out: in division mode a week produces
  // no fixtures until some division has 2+ registered members, which otherwise
  // looks like the button silently failing.
  async function doGenerate() {
    setBusy(true);
    try {
      await generateWeek(league!.id, week);
      await load();
      const fresh = await fetchFixtures(id, week);
      if (fresh.length === 0 && divisions.length > 0) {
        Alert.alert(t('le.genTitle').replace('{w}', String(week)), t('le.genNoDivEntrants'));
      }
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  // Confirm + guard generating this week's fixtures.
  function confirmGenWeek() {
    if (members.length < 2) { Alert.alert(t('le.needMoreTitle'), t('le.needMoreBody')); return; }
    Alert.alert(
      t('le.genTitle').replace('{w}', String(week)),
      t('le.genBody').replace('{n}', String(members.length)),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('le.generate'), onPress: () => doGenerate() },
      ],
    );
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
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>{t('le.invitedTitle')}</ThemedText>
          <Card style={{ gap: Spacing.two }}>
            <ThemedText type="small" themeColor="textSecondary">{t('le.invitedBody')}</ThemedText>
            <Button label={t('le.acceptInvite')} icon="checkmark-circle" loading={busy} onPress={() => act(() => respondLeagueInvite(id, true))} />
            <Button label={t('le.declineInvite')} variant="ghost" loading={busy} onPress={() => act(() => respondLeagueInvite(id, false))} />
          </Card>
        </View>
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

      {/* Organizer: invite specific people (opens the dedicated invite screen) */}
      {isOrganizer && (
        <Button
          label={t('le.invitePlayers')}
          icon="person-add"
          variant="secondary"
          onPress={() => router.push({ pathname: '/invite', params: { type: 'league', id: league.id, name: league.name } })}
        />
      )}

      {/* Announcements */}
      {(isMember || isOrganizer) && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('le.announcements')}</ThemedText>
          {isOrganizer && (
            <Card style={{ gap: Spacing.two }}>
              <TextField
                label={t('le.postAnnouncement')}
                value={msgText}
                onChangeText={setMsgText}
                placeholder={t('le.announcePlaceholder')}
                multiline
              />
              <Button label={t('le.post')} icon="megaphone" loading={postingMsg} onPress={postAnnouncement} />
            </Card>
          )}
          {messages.length === 0 ? (
            <EmptyState icon="megaphone-outline" title={t('le.noAnnouncements')} subtitle={isOrganizer ? t('le.noAnnouncementsOrg') : t('le.noAnnouncementsSub')} />
          ) : (
            <>
              <Card style={{ paddingVertical: Spacing.one }}>
                {(showOlderMsgs ? messages : messages.slice(0, 3)).map((m, i) => (
                  <View key={m.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                    <View style={{ paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, gap: 2 }}>
                      <ThemedText>{m.body}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {m.author?.display_name ?? t('le.organizer')} · {new Date(m.created_at).toLocaleDateString()}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </Card>
              {messages.length > 3 && !showOlderMsgs && (
                <Pressable onPress={() => setShowOlderMsgs(true)} style={[styles.older, { borderColor: theme.tileBorder }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">{t('ui.showOlder')}</ThemedText>
                </Pressable>
              )}
            </>
          )}
        </>
      )}

      {/* Team-format league: organizer builds the rosters; members see them read-only. */}
      {isTeamLeague && (
        <LeagueTeams
          leagueId={league.id}
          teamSize={league.team_size}
          userId={userId}
          readOnly={!isOrganizer}
          onChanged={load}
        />
      )}

      {/* Individual league: organizer builds divisions; members self-register by
          eligibility. A league with no divisions runs the legacy single pool. */}
      {!isTeamLeague && isOrganizer && <LeagueDivisions leagueId={league.id} onChanged={load} />}
      {!isTeamLeague && isMember && <LeagueDivisionRegister leagueId={league.id} onChanged={load} />}

      {/* Team leagues: season play (fixtures / scoring / playoff) is a later phase.
          Show the roster builder above; skip the individual weekly pairing here. */}
      {isTeamLeague && (
        <Card style={{ gap: Spacing.one }}>
          <ThemedText style={{ fontWeight: '700' }}>{t('lt.seasonSoonTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t('lt.seasonSoonBody')}</ThemedText>
        </Card>
      )}

      {/* This week (individual leagues) */}
      {!isTeamLeague && (
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('le.thisWeek')}</ThemedText>
      )}
      {!isTeamLeague && isOrganizer && fixtures.length === 0 && (
        <Button label={t('le.generate')} icon="shuffle" variant="secondary" loading={busy} onPress={confirmGenWeek} />
      )}
      {!isTeamLeague && (fixtures.length === 0 ? (
        <EmptyState icon="shuffle-outline" title={t('le.noFixturesTitle')} subtitle={isOrganizer ? t('le.noFixturesOrg') : t('le.noFixturesSub')} />
      ) : (
        <>
          {isMember && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>{t('le.yourMatch')}</ThemedText>
              <Card style={{ gap: Spacing.two }}>
                {!myFixture ? (
                  <ThemedText themeColor="textSecondary">{t('le.notPaired')}</ThemedText>
                ) : !myFixture.player_b ? (
                  <ThemedText themeColor="textSecondary">{t('le.bye')}</ThemedText>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
                    <Avatar name={(myFixture.player_a === userId ? myFixture.b : myFixture.a)?.display_name ?? '?'} size={40} />
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
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
            </View>
          )}

          <Card style={{ paddingVertical: Spacing.one }}>
            {fixtures.map((f, i) => {
              const divName = f.division_id ? divisions.find((d) => d.id === f.division_id)?.name : null;
              return (
                <View key={f.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <View style={styles.fixtureRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText numberOfLines={1}>
                        {f.a?.display_name ?? '?'} {f.player_b ? `${t('le.vs')} ${f.b?.display_name ?? '?'}` : `· ${t('le.byeShort')}`}
                      </ThemedText>
                      {divName ? (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{divName}</ThemedText>
                      ) : null}
                    </View>
                    {f.match_id && <Ionicons name="checkmark-circle" size={18} color={theme.success} />}
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ))}

      {/* Standings (individual leagues; team standings arrive with team fixtures) */}
      {!isTeamLeague && (
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('le.standings')}</ThemedText>
      )}
      {!isTeamLeague && (standings.length === 0 ? (
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
      ))}

      {/* Members */}
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>{t('le.members')} · {members.length}</ThemedText>
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
  section: { marginTop: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  fixtureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
  older: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999, borderWidth: 1 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  prow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
});
