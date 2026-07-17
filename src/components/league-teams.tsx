import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/lib/i18n';
import {
  addLeagueTeamMember,
  createLeagueTeam,
  deleteLeagueTeam,
  fetchLeagueTeams,
  removeLeagueTeamMember,
} from '@/lib/leagues';
import { searchProfiles } from '@/lib/matches';
import type { LeagueTeam, Profile } from '@/lib/types';

/**
 * Organizer-only team builder for a team-format league (2v2 / 3v3 / quintet):
 * create teams, and add/remove rostered players (capped at the league's team
 * size). A player can be on only one team per league (enforced server-side).
 */
export function LeagueTeams({
  leagueId,
  teamSize,
  userId,
  readOnly,
  onChanged,
}: {
  leagueId: string;
  teamSize: number;
  userId: string;
  /** members see rosters but cannot edit them */
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [teams, setTeams] = useState<LeagueTeam[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);

  const reload = useCallback(async () => {
    try {
      setTeams(await fetchLeagueTeams(leagueId));
    } catch (e) {
      console.warn('league teams load failed', e);
    }
  }, [leagueId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!addingTo) return;
    const h = setTimeout(async () => {
      try {
        setResults(q.trim() ? await searchProfiles(q, []) : []);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q, addingTo]);

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
      onChanged?.();
    } catch (e: any) {
      Alert.alert(t('md.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  function addTeam() {
    const n = newName.trim();
    if (!n || busy) return;
    act(() => createLeagueTeam(leagueId, n).then(() => setNewName('')));
  }

  // The signed-in user is on at most one team per league; used to offer "Add me".
  const onATeam = teams.some((tm) => tm.members.some((m) => m.user_id === userId));

  function confirmDeleteTeam(team: LeagueTeam) {
    Alert.alert(t('lt.deleteTitle'), t('lt.deleteBody').replace('{name}', team.name), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('tdv.delete'), style: 'destructive', onPress: () => act(() => deleteLeagueTeam(team.id)) },
    ]);
  }

  async function pickMember(teamId: string, p: Profile) {
    setAddingTo(null);
    setQ('');
    setResults([]);
    await act(() => addLeagueTeamMember(teamId, p.id));
  }

  return (
    <>
      <ThemedText style={styles.section}>{t('lt.teams')} · {teams.length}</ThemedText>

      {!readOnly && (
        <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField value={newName} onChangeText={setNewName} placeholder={t('lt.teamNamePh')} />
          </View>
          <Button label={t('lt.addTeam')} icon="add" loading={busy} onPress={addTeam} />
        </View>
      )}

      {teams.map((team) => {
        const full = team.members.length >= teamSize;
        return (
          <Card key={team.id} style={{ gap: Spacing.one }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText style={{ flex: 1, fontWeight: '800' }} numberOfLines={1}>{team.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{team.members.length}/{teamSize}</ThemedText>
              {!readOnly && (
                <Pressable onPress={() => confirmDeleteTeam(team)} hitSlop={8} style={{ padding: Spacing.one }}>
                  <Ionicons name="trash-outline" size={18} color={theme.danger} />
                </Pressable>
              )}
            </View>

            {team.members.map((m) => (
              <View key={m.user_id} style={styles.prow}>
                <Avatar name={m.display_name} size={28} />
                <ThemedText style={{ flex: 1 }} numberOfLines={1}>
                  {m.display_name}{m.user_id === userId ? ` ${t('md.you')}` : ''}
                </ThemedText>
                <BeltChip belt={m.belt_rank} size="sm" />
                {!readOnly && (
                  <Pressable onPress={() => act(() => removeLeagueTeamMember(team.id, m.user_id))} hitSlop={8} style={{ padding: 4 }}>
                    <Ionicons name="close-circle-outline" size={18} color={theme.danger} />
                  </Pressable>
                )}
              </View>
            ))}

            {!readOnly && !full && !onATeam && (
              <Button label={t('lt.addMe')} icon="person" variant="secondary" onPress={() => act(() => addLeagueTeamMember(team.id, userId))} />
            )}
            {!readOnly && !full && addingTo !== team.id && (
              <Button label={t('lt.addMember')} variant="ghost" onPress={() => { setAddingTo(team.id); setQ(''); setResults([]); }} />
            )}

            {addingTo === team.id && (
              <View style={{ gap: Spacing.two }}>
                <TextField value={q} onChangeText={setQ} placeholder={t('mn.searchPlaceholder')} autoCapitalize="none" />
                {results.slice(0, 6).map((p) => (
                  <Pressable key={p.id} onPress={() => pickMember(team.id, p)} style={styles.prow}>
                    <Avatar name={p.display_name} size={28} warrior={p.avatar_warrior ?? undefined} color={p.avatar_color ?? undefined} />
                    <ThemedText style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{p.display_name}</ThemedText>
                    <BeltChip belt={p.belt_rank} size="sm" />
                  </Pressable>
                ))}
                <Button label={t('common.cancel')} variant="ghost" onPress={() => { setAddingTo(null); setQ(''); }} />
              </View>
            )}
          </Card>
        );
      })}

      {teams.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">{t('lt.none')}</ThemedText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 18, fontWeight: '800', marginTop: Spacing.one },
  prow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 4 },
});
