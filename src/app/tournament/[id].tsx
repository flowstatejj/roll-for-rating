import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n';
import { searchProfiles } from '@/lib/matches';
import { supabase } from '@/lib/supabase';
import {
  addTeamMember,
  assignBoutMat,
  autoBalanceTeams,
  createTeam,
  fetchBouts,
  fetchMats,
  fetchStandingsPro,
  fetchTeams,
  fetchTournament,
  generatePlayoff,
  generateTournament,
  registerForTournament,
  setMatReferee,
} from '@/lib/tournaments';
import type {
  Profile,
  Tournament,
  TournamentBout,
  TournamentMat,
  TournamentStandingPro,
  TournamentTeam,
} from '@/lib/types';

type Picker = { mode: 'ref'; matId: string } | { mode: 'member'; teamId: string } | null;

export default function TournamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const userId = session!.user.id;

  const [tr, setTr] = useState<Tournament | null>(null);
  const [entrants, setEntrants] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [mats, setMats] = useState<TournamentMat[]>([]);
  const [bouts, setBouts] = useState<TournamentBout[]>([]);
  const [standings, setStandings] = useState<TournamentStandingPro[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [picker, setPicker] = useState<Picker>(null);
  const [pq, setPq] = useState('');
  const [presults, setPresults] = useState<Profile[]>([]);
  const [newTeam, setNewTeam] = useState('');

  const load = useCallback(async () => {
    try {
      const trow = await fetchTournament(id);
      setTr(trow);
      const { data: ent } = await supabase
        .from('tournament_entrants')
        .select('profile:profiles(id, username, display_name, belt_rank, rating, is_minor)')
        .eq('tournament_id', id);
      setEntrants(((ent ?? []).map((e: any) => e.profile).filter(Boolean)) as Profile[]);
      const [tm, mt, bt] = await Promise.all([fetchTeams(id), fetchMats(id), fetchBouts(id)]);
      setTeams(tm);
      setMats(mt);
      setBouts(bt);
      if (trow && (trow.format === 'round_robin' || trow.format === 'rr_playoff')) {
        setStandings(await fetchStandingsPro(id, trow.team_rule));
      } else {
        setStandings([]);
      }
    } catch (e) {
      console.warn('tournament load failed', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!picker) return;
    const h = setTimeout(async () => {
      try { setPresults(await searchProfiles(pq, [])); } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(h);
  }, [pq, picker]);

  if (loading) return <Loading />;
  if (!tr) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="trophy-outline" title={t('tn.notFound')} subtitle="" />
      </Screen>
    );
  }

  const isHost = tr.host_id === userId;
  const isTeam = tr.team_rule !== 'none';
  const isEntrant = entrants.some((e) => e.id === userId);
  const generated = bouts.length > 0;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await load(); }
    catch (e: any) { Alert.alert(t('md.error'), e.message ?? t('md.tryAgain')); }
    finally { setBusy(false); }
  }

  async function pick(p: Profile) {
    if (!picker) return;
    const cur = picker;
    setPicker(null); setPq(''); setPresults([]);
    if (cur.mode === 'ref') await act(() => setMatReferee(cur.matId, p.id));
    else await act(() => addTeamMember(cur.teamId, p.id));
  }

  async function shareCode() {
    try { await Share.share({ message: t('tn.shareMsg').replace('{name}', tr!.name).replace('{code}', tr!.join_code ?? '') }); }
    catch { Alert.alert(t('tn.code'), tr!.join_code ?? ''); }
  }

  function assignMat(b: TournamentBout) {
    if (mats.length === 1) { act(() => assignBoutMat(b.id, mats[0].id)); return; }
    Alert.alert(t('tn.assignMat'), '', [
      ...mats.map((m) => ({
        text: `${t('tn.mat')} ${m.mat_no}${m.referee?.display_name ? ` (${m.referee.display_name})` : ''}`,
        onPress: () => act(() => assignBoutMat(b.id, m.id)),
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  const rounds = [...new Set(bouts.map((b) => `${b.bracket}:${b.round_no}`))];

  return (
    <Screen>
      <Stack.Screen options={{ title: tr.name }} />

      {/* Header */}
      <Card style={{ gap: Spacing.two }}>
        <ThemedText style={{ fontWeight: '800', fontSize: 22 }}>{tr.name}</ThemedText>
        {tr.description ? <ThemedText themeColor="textSecondary">{tr.description}</ThemedText> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one }}>
          <Tag text={t(`tn.fmt.${tr.format}`)} tint={theme.accent} />
          <Tag text={isTeam ? `${tr.team_size}v${tr.team_size} · ${t(`tn.rule.${tr.team_rule}`)}` : t('tn.individual')} tint={theme.textSecondary} />
          <Tag text={tr.ranked ? t('tn.rankedChip') : t('tn.casualChip')} tint={tr.ranked ? theme.accent : theme.textSecondary} />
          <Tag text={t(`tn.status.${tr.status}`)} tint={tr.status === 'running' ? theme.success : theme.textSecondary} />
        </View>
        <Pressable onPress={shareCode} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <Ionicons name="key-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary">{t('tn.code')}: {tr.join_code} · {t('tn.tapShare')}</ThemedText>
        </Pressable>
      </Card>

      {/* Register */}
      {!isEntrant && tr.status !== 'complete' && (
        <Button label={isTeam ? t('tn.registerTeam') : t('tn.register')} icon="add-circle" loading={busy} onPress={() => act(() => registerForTournament(id))} />
      )}
      {isEntrant && <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>{t('tn.registered')}</ThemedText>}

      {/* Picker panel */}
      {picker && (
        <Card style={{ gap: Spacing.two, borderColor: theme.accent, borderWidth: 1 }}>
          <ThemedText style={{ fontWeight: '800' }}>{picker.mode === 'ref' ? t('tn.pickRef') : t('tn.pickMember')}</ThemedText>
          <TextField value={pq} onChangeText={setPq} placeholder={t('mn.searchPlaceholder')} autoCapitalize="none" />
          {presults.slice(0, 8).map((p) => (
            <Pressable key={p.id} onPress={() => pick(p)}>
              <View style={styles.prow}>
                <Avatar name={p.display_name} size={32} />
                <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{p.display_name}</ThemedText>
                <BeltChip belt={p.belt_rank} size="sm" />
              </View>
            </Pressable>
          ))}
          <Button label={t('common.cancel')} variant="ghost" onPress={() => { setPicker(null); setPq(''); }} />
        </Card>
      )}

      {/* Teams */}
      {isTeam && (
        <>
          <View style={styles.sectionRow}>
            <ThemedText style={styles.section}>{t('tn.teams')}</ThemedText>
            {isHost && tr.status === 'setup' && tr.team_build === 'auto' && (
              <Button label={t('tn.autoBalance')} variant="secondary" loading={busy} onPress={() => act(() => autoBalanceTeams(id))} />
            )}
          </View>
          {(isHost || tr.team_build === 'captain') && tr.status === 'setup' && tr.team_build !== 'auto' && (
            <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><TextField value={newTeam} onChangeText={setNewTeam} placeholder={t('tn.teamNamePh')} /></View>
              <Button
                label={t('tn.addTeam')}
                loading={busy}
                onPress={() => {
                  const n = newTeam.trim();
                  if (!n) return;
                  setNewTeam('');
                  act(() => createTeam(id, n, tr.team_build === 'captain' ? userId : undefined));
                }}
              />
            </View>
          )}
          {teams.length === 0 ? (
            <EmptyState icon="people-outline" title={t('tn.noTeams')} subtitle={isHost ? t('tn.noTeamsHost') : t('tn.noTeamsSub')} />
          ) : (
            teams.map((team) => {
              const canManage = isHost || team.captain_id === userId;
              const full = (team.members?.length ?? 0) >= tr.team_size;
              return (
                <Card key={team.id} style={{ gap: Spacing.one }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <ThemedText style={{ flex: 1, fontWeight: '800' }}>{team.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{team.members?.length ?? 0}/{tr.team_size}</ThemedText>
                  </View>
                  {(team.members ?? []).map((m) => (
                    <View key={m.user_id} style={styles.prow}>
                      <Avatar name={m.display_name} size={28} />
                      <ThemedText style={{ flex: 1 }} numberOfLines={1}>{m.display_name}</ThemedText>
                      <BeltChip belt={m.belt_rank} size="sm" />
                    </View>
                  ))}
                  {canManage && tr.status === 'setup' && !full && (
                    <Button label={t('tn.addMember')} variant="ghost" onPress={() => { setPicker({ mode: 'member', teamId: team.id }); setPq(''); }} />
                  )}
                </Card>
              );
            })
          )}
        </>
      )}

      {/* Mats */}
      <ThemedText style={styles.section}>{t('tn.mats')} · {mats.length}</ThemedText>
      {mats.map((m) => (
        <Card key={m.id} style={styles.matRow}>
          <Ionicons name="grid-outline" size={20} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: '800' }}>{t('tn.mat')} {m.mat_no}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {m.referee?.display_name ? `${t('tn.ref')}: ${m.referee.display_name}` : t('tn.noRef')}
            </ThemedText>
          </View>
          {isHost && (
            <Button label={t('tn.setRef')} variant="ghost" onPress={() => { setPicker({ mode: 'ref', matId: m.id }); setPq(''); }} />
          )}
        </Card>
      ))}

      {/* Host: generate */}
      {isHost && !generated && (
        <Button label={t('tn.generate')} icon="shuffle" loading={busy} onPress={() => act(() => generateTournament(id))} />
      )}
      {isHost && generated && tr.format === 'rr_playoff' && !bouts.some((b) => b.bracket === 'playoff') && (
        <Button label={t('tn.startPlayoff')} icon="trophy" variant="secondary" loading={busy} onPress={() => act(() => generatePlayoff(id, 4))} />
      )}

      {/* Bracket / bouts */}
      {generated && (
        <>
          <ThemedText style={styles.section}>{t('tn.bouts')}</ThemedText>
          {rounds.map((rk) => {
            const [bracket, rn] = rk.split(':');
            const rbouts = bouts.filter((b) => `${b.bracket}:${b.round_no}` === rk);
            return (
              <View key={rk} style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {bracket === 'playoff' ? t('tn.playoff') : t('tn.round')} {rn}
                </ThemedText>
                {rbouts.map((b) => {
                  const canRec =
                    (b.referee_id === userId || isHost || mats.some((m) => m.id === b.mat_id && m.referee_id === userId)) &&
                    b.status !== 'done' && b.status !== 'bye' && !!b.a_name && !!b.b_name;
                  const mat = mats.find((m) => m.id === b.mat_id);
                  return (
                    <Card key={b.id} style={styles.boutRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>
                          {b.a_name ?? t('tn.tbd')} {t('le.vs')} {b.b_name ?? t('tn.tbd')}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {b.status === 'done'
                            ? (b.winner === 'draw' ? t('md.drawChoice') : `${b.winner === 'a' ? b.a_name : b.b_name} ${t('md.won')}${isTeam ? ` (${b.a_score}-${b.b_score})` : ''}`)
                            : b.status === 'bye' ? t('le.byeShort')
                            : mat ? `${t('tn.mat')} ${mat.mat_no}` : t('tn.unassigned')}
                        </ThemedText>
                      </View>
                      {b.status === 'done' && <Ionicons name="checkmark-circle" size={20} color={theme.success} />}
                      {isHost && b.status !== 'done' && b.status !== 'bye' && mats.length > 0 && !!b.a_name && !!b.b_name && (
                        <Pressable onPress={() => assignMat(b)} hitSlop={8} style={{ paddingHorizontal: Spacing.one }}>
                          <Ionicons name="grid-outline" size={18} color={theme.accent} />
                        </Pressable>
                      )}
                      {canRec && <Button label={t('tn.record')} onPress={() => router.push(`/tournament/bout/${b.id}`)} />}
                    </Card>
                  );
                })}
              </View>
            );
          })}
        </>
      )}

      {/* Standings (round robin) */}
      {(tr.format === 'round_robin' || tr.format === 'rr_playoff') && (
        <>
          <ThemedText style={styles.section}>{t('tn.standings')}</ThemedText>
          {standings.length === 0 ? (
            <EmptyState icon="podium-outline" title={t('tn.noStandings')} subtitle="" />
          ) : (
            <Card style={{ paddingVertical: Spacing.one, paddingHorizontal: Spacing.one }}>
              {standings.map((s, i) => (
                <View key={s.user_id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: theme.tileBorder }]} />}
                  <View style={styles.standRow}>
                    <ThemedText style={{ width: 22, fontWeight: '800', color: theme.textSecondary }}>{i + 1}</ThemedText>
                    <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{s.name ?? '?'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{s.wins}{t('lb.w')}·{s.losses}{t('lb.l')}·{s.draws}{t('lb.d')}</ThemedText>
                    <ThemedText style={{ width: 40, textAlign: 'right', fontWeight: '800' }}>{s.points}</ThemedText>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
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
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.one },
  prow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 4 },
  matRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  boutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  standRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
});
