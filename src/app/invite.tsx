import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar, BeltChip, Button, Card, EmptyState, Loading, Screen, TextField } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchMyFriends } from '@/lib/friends';
import { useTranslation } from '@/lib/i18n';
import { fetchLeagueInvitesSent, inviteManyToLeague } from '@/lib/leagues';
import { searchProfiles } from '@/lib/matches';
import { fetchTournamentInvitesSent, inviteManyToTournament } from '@/lib/tournaments';
import type { BeltRank, SentInvite } from '@/lib/types';

type Person = { id: string; display_name: string; username: string; belt_rank: string; rating: number };

export default function InviteScreen() {
  const { type, id, name } = useLocalSearchParams<{ type: string; id: string; name?: string }>();
  const isLeague = type === 'league';
  const theme = useTheme();
  const { t } = useTranslation();
  const { session } = useAuth();
  const myId = session!.user.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [friends, setFriends] = useState<Person[]>([]);
  const [pq, setPq] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [staged, setStaged] = useState<Person[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'invited' | 'declined'>('invited');

  const fetchSent = useCallback(
    () => (isLeague ? fetchLeagueInvitesSent(id) : fetchTournamentInvitesSent(id)),
    [isLeague, id],
  );

  const loadSent = useCallback(async () => {
    try {
      setSent(await fetchSent());
    } catch (e) {
      console.warn('invites sent failed', e);
    } finally {
      setLoading(false);
    }
  }, [fetchSent]);

  useFocusEffect(useCallback(() => { loadSent(); }, [loadSent]));
  useEffect(() => {
    fetchMyFriends().then((f) => setFriends(f as Person[])).catch(() => {});
  }, []);

  // Anyone already in (pending/accepted) or already staged can't be re-added;
  // declined people CAN be invited again.
  const blocked = useMemo(() => {
    const s = new Set<string>([myId, ...staged.map((p) => p.id)]);
    for (const i of sent) if (i.status !== 'declined') s.add(i.user_id);
    return s;
  }, [myId, staged, sent]);

  // Empty box shows your friends; typing searches everyone. Filter the blocked.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!pq.trim()) { setResults([]); return; }
      try {
        const r = await searchProfiles(pq.trim(), []);
        if (alive) setResults(r as Person[]);
      } catch { /* ignore */ }
    };
    run();
    return () => { alive = false; };
  }, [pq]);

  const options = useMemo(() => {
    const base = pq.trim() ? results : friends;
    return base.filter((p) => !blocked.has(p.id));
  }, [pq, results, friends, blocked]);

  function add(p: Person) {
    setStaged((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setChecked((prev) => new Set(prev).add(p.id));
  }
  function removeStaged(pid: string) {
    setStaged((prev) => prev.filter((p) => p.id !== pid));
    setChecked((prev) => { const n = new Set(prev); n.delete(pid); return n; });
  }
  function toggle(pid: string) {
    setChecked((prev) => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }
  function toggleAll(all: boolean) {
    setChecked(all ? new Set(staged.map((p) => p.id)) : new Set());
  }

  async function send() {
    const ids = staged.filter((p) => checked.has(p.id)).map((p) => p.id);
    if (ids.length === 0) { Alert.alert(t('inv.noneTitle'), t('inv.noneBody')); return; }
    setBusy(true);
    try {
      const n = isLeague ? await inviteManyToLeague(id, ids) : await inviteManyToTournament(id, ids);
      setStaged([]); setChecked(new Set()); setPq('');
      await loadSent();
      Alert.alert('✅', t('inv.sentN').replace('{n}', String(n)));
    } catch (e: any) {
      Alert.alert(t('inv.error'), e.message ?? t('md.tryAgain'));
    } finally {
      setBusy(false);
    }
  }

  const invited = useMemo(() => sent.filter((s) => s.status !== 'declined'), [sent]);
  const declined = useMemo(() => sent.filter((s) => s.status === 'declined'), [sent]);
  const list = tab === 'invited' ? invited : declined;
  const checkedCount = staged.filter((p) => checked.has(p.id)).length;
  const allChecked = staged.length > 0 && checkedCount === staged.length;

  if (loading) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('inv.title') }} />

      {name ? <ThemedText type="small" themeColor="textSecondary">{name}</ThemedText> : null}

      {/* Search "dropdown" */}
      <Card style={{ gap: Spacing.three }}>
        <ThemedText style={{ fontWeight: '800' }}>{t('inv.addHint')}</ThemedText>
        <TextField value={pq} onChangeText={setPq} placeholder={t('frn.searchPh')} autoCapitalize="none" autoCorrect={false} />
        <View style={{ gap: Spacing.one }}>
          {options.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {pq.trim() ? t('inv.noMatches') : (friends.length ? t('frn.inviteFriendsHint') : t('inv.searchHint'))}
            </ThemedText>
          ) : (
            options.slice(0, 10).map((p) => (
              <Pressable key={p.id} onPress={() => add(p)} style={styles.opt}>
                <Avatar name={p.display_name} size={34} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{p.display_name}</ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                    <BeltChip belt={p.belt_rank as BeltRank} size="sm" />
                    <ThemedText type="small" themeColor="textSecondary">@{p.username} · {p.rating}</ThemedText>
                  </View>
                </View>
                <Ionicons name="add-circle" size={24} color={theme.accent} />
              </Pressable>
            ))
          )}
        </View>
      </Card>

      {/* Staging list with checkboxes */}
      {staged.length > 0 && (
        <Card style={{ gap: Spacing.two }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ThemedText style={{ fontWeight: '800', flex: 1 }}>{t('inv.selected')} · {staged.length}</ThemedText>
            <Pressable onPress={() => toggleAll(!allChecked)} hitSlop={8}>
              <ThemedText style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>
                {allChecked ? t('inv.selectNone') : t('inv.selectAll')}
              </ThemedText>
            </Pressable>
          </View>
          {staged.map((p) => {
            const on = checked.has(p.id);
            return (
              <View key={p.id} style={styles.row}>
                <Pressable onPress={() => toggle(p.id)} hitSlop={8}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? theme.accent : theme.textSecondary} />
                </Pressable>
                <Avatar name={p.display_name} size={34} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{p.display_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">@{p.username} · {p.rating}</ThemedText>
                </View>
                <Pressable onPress={() => removeStaged(p.id)} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>
            );
          })}
          <Button
            label={t('inv.send').replace('{n}', String(checkedCount))}
            icon="paper-plane"
            onPress={send}
            loading={busy}
            disabled={checkedCount === 0}
          />
        </Card>
      )}

      {/* Invited / Declined tabs */}
      <View style={styles.tabs}>
        <Tab label={`${t('inv.tabInvited')} · ${invited.length}`} active={tab === 'invited'} onPress={() => setTab('invited')} />
        <Tab label={`${t('inv.tabDeclined')} · ${declined.length}`} active={tab === 'declined'} onPress={() => setTab('declined')} />
      </View>

      {list.length === 0 ? (
        <EmptyState
          icon="mail-outline"
          title={tab === 'invited' ? t('inv.noneInvited') : t('inv.noneDeclined')}
          subtitle={tab === 'invited' ? t('inv.noneInvitedSub') : t('inv.noneDeclinedSub')}
        />
      ) : (
        <View style={{ gap: Spacing.two }}>
          {list.map((s) => (
            <Card key={s.user_id} style={styles.row}>
              <Avatar name={s.display_name} size={38} />
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: '700' }} numberOfLines={1}>{s.display_name}</ThemedText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                  <BeltChip belt={s.belt_rank as BeltRank} size="sm" />
                  <ThemedText type="small" themeColor="textSecondary">@{s.username}</ThemedText>
                </View>
              </View>
              <StatusPill status={s.status} />
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, { backgroundColor: active ? theme.accent : theme.tile, borderColor: active ? theme.accent : theme.tileBorder }]}>
      <ThemedText style={{ color: active ? theme.accentText : theme.text, fontWeight: '700', fontSize: 13 }}>{label}</ThemedText>
    </Pressable>
  );
}

function StatusPill({ status }: { status: SentInvite['status'] }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const color = status === 'accepted' ? theme.accent : status === 'declined' ? theme.danger : theme.textSecondary;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <ThemedText style={{ color, fontWeight: '800', fontSize: 11 }}>{t(`inv.status.${status}`)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  tabs: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  tab: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: Spacing.two, paddingVertical: 4 },
});
